"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";

const AlarmMap = dynamic(() => import("@/components/AlarmMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded-2xl border border-white/20 bg-black/20 p-6 text-center text-white/80">
      Loading map...
    </div>
  ),
});

type Alarm = {
  id: string;
  site_name: string;
  alarm_type: string;
  location: string | null;
  priority: string;
  status: string;
  message: string | null;
  created_at: string;
  triggered_by_user_id: string | null;
  triggered_by_name: string | null;
  triggered_by_role: string | null;
  acknowledged: boolean | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
};

type UserLocation = {
  user_id: string;
  full_name: string | null;
  role: string | null;
  site_name: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  updated_at: string;
};

type PresenceUser = {
  user_id: string;
  full_name: string | null;
  role: string | null;
  site_name: string | null;
  is_logged_in: boolean;
  last_seen: string | null;
  updated_at: string;
};

type MovementWatchState = {
  enabled: boolean;
  baselineLat: number;
  baselineLng: number;
  baselineTime: string;
  alertActive: boolean;
};

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const STALE_TRACKING_MS = 2 * 60 * 1000;
const NO_MOVEMENT_LIMIT_MS = 50 * 60 * 1000;
const MOVEMENT_THRESHOLD_METERS = 20;

function getAlarmTheme(alarmType: string) {
  const type = alarmType.toLowerCase();

  if (type === "panic") {
    return {
      panel: "bg-red-700",
      title: "🚨 PANIC ALERT 🚨",
      flashClass: "ring-red-300/70",
      backdrop: "bg-red-950/35",
    };
  }

  if (type === "lockdown") {
    return {
      panel: "bg-purple-700",
      title: "🔒 LOCKDOWN ALERT 🔒",
      flashClass: "ring-purple-300/70",
      backdrop: "bg-purple-950/35",
    };
  }

  if (type === "medical") {
    return {
      panel: "bg-blue-700",
      title: "🏥 MEDICAL ALERT 🏥",
      flashClass: "ring-blue-300/70",
      backdrop: "bg-blue-950/35",
    };
  }

  if (type === "fire") {
    return {
      panel: "bg-orange-600",
      title: "🔥 FIRE ALERT 🔥",
      flashClass: "ring-orange-300/70",
      backdrop: "bg-orange-950/35",
    };
  }

  return {
    panel: "bg-slate-700",
    title: "⚠️ ALERT ⚠️",
    flashClass: "ring-slate-300/60",
    backdrop: "bg-slate-950/35",
  };
}

function getAlarmPriorityWeight(alarmType: string) {
  const type = alarmType.toLowerCase();
  if (type === "panic") return 4;
  if (type === "lockdown") return 3;
  if (type === "fire") return 2;
  if (type === "medical") return 1;
  return 0;
}

function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
}

function dedupeLatestUserLocations(rows: UserLocation[]) {
  const latestByUser = new Map<string, UserLocation>();

  for (const row of rows) {
    const existing = latestByUser.get(row.user_id);

    if (!existing) {
      latestByUser.set(row.user_id, row);
      continue;
    }

    const existingTime = new Date(existing.updated_at).getTime();
    const rowTime = new Date(row.updated_at).getTime();

    if (rowTime > existingTime) {
      latestByUser.set(row.user_id, row);
    }
  }

  return Array.from(latestByUser.values()).sort((a, b) => {
    return (
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  });
}

function dedupeLatestPresence(rows: PresenceUser[]) {
  const latestByUser = new Map<string, PresenceUser>();

  for (const row of rows) {
    const existing = latestByUser.get(row.user_id);

    if (!existing) {
      latestByUser.set(row.user_id, row);
      continue;
    }

    const existingTime = new Date(existing.updated_at).getTime();
    const rowTime = new Date(row.updated_at).getTime();

    if (rowTime > existingTime) {
      latestByUser.set(row.user_id, row);
    }
  }

  return Array.from(latestByUser.values()).sort((a, b) => {
    return (a.full_name || "").localeCompare(b.full_name || "");
  });
}

function isPresenceOnline(user: PresenceUser) {
  if (!user.is_logged_in || !user.last_seen) return false;
  return Date.now() - new Date(user.last_seen).getTime() <= ONLINE_WINDOW_MS;
}

function isTrackedRecently(updatedAt: string) {
  return Date.now() - new Date(updatedAt).getTime() <= STALE_TRACKING_MS;
}

function minutesSince(timestamp: string) {
  return Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
}

function getIdleMinutesForUser(
  userId: string,
  movementWatch: Record<string, MovementWatchState>
) {
  const watch = movementWatch[userId];
  if (!watch?.enabled) return null;

  return Math.max(0, minutesSince(watch.baselineTime));
}

function getIdleBadgeClasses(idleMinutes: number | null) {
  if (idleMinutes === null) {
    return "bg-slate-700 text-slate-200 border-slate-500";
  }

  if (idleMinutes >= 50) {
    return "bg-red-600 text-white border-red-300";
  }

  if (idleMinutes >= 35) {
    return "bg-amber-500 text-black border-amber-200";
  }

  return "bg-emerald-600 text-white border-emerald-200";
}

function formatIdleBadge(idleMinutes: number | null) {
  if (idleMinutes === null) return "--";

  if (idleMinutes < 60) {
    return `${idleMinutes}m`;
  }

  const hours = Math.floor(idleMinutes / 60);
  const minutes = idleMinutes % 60;
  return `${hours}h${minutes}m`;
}

export default function DispatcherPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [userLocations, setUserLocations] = useState<UserLocation[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [statusMessage, setStatusMessage] = useState("Starting...");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [lastAlarmId, setLastAlarmId] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [movementWatch, setMovementWatch] = useState<
    Record<string, MovementWatchState>
  >({});

  const alarmAudioRef = useRef<HTMLAudioElement | null>(null);
  const movementAudioRef = useRef<HTMLAudioElement | null>(null);

  const loadAlarms = useCallback(async () => {
    const { data, error } = await supabase
      .from("alarms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setStatusMessage(`Load alarms error: ${error.message}`);
      return;
    }

    setAlarms((data || []) as Alarm[]);
  }, []);

  const loadUserLocations = useCallback(async () => {
    const { data, error } = await supabase
      .from("user_locations")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      setStatusMessage(`Load user locations error: ${error.message}`);
      return;
    }

    const cleaned = dedupeLatestUserLocations((data || []) as UserLocation[]);
    setUserLocations(cleaned);
  }, []);

  const loadPresenceUsers = useCallback(async () => {
    const { data, error } = await supabase
      .from("user_presence")
      .select("*")
      .order("full_name", { ascending: true });

    if (error) {
      setStatusMessage(`Load user presence error: ${error.message}`);
      return;
    }

    const cleaned = dedupeLatestPresence((data || []) as PresenceUser[]);
    setPresenceUsers(cleaned);
  }, []);

  function enableSound() {
    if (!alarmAudioRef.current || !movementAudioRef.current) return;

    Promise.all([
      alarmAudioRef.current.play().then(() => {
        alarmAudioRef.current?.pause();
        if (alarmAudioRef.current) alarmAudioRef.current.currentTime = 0;
      }),
      movementAudioRef.current.play().then(() => {
        movementAudioRef.current?.pause();
        if (movementAudioRef.current) movementAudioRef.current.currentTime = 0;
      }),
    ])
      .then(() => {
        setSoundEnabled(true);
        setStatusMessage("Dispatcher sound enabled");
      })
      .catch((err) => {
        console.error("Sound enable failed:", err);
        setStatusMessage("Browser blocked audio. Tap Enable Sound again.");
      });
  }

  function stopAlarmSound() {
    if (!alarmAudioRef.current) return;
    alarmAudioRef.current.pause();
    alarmAudioRef.current.currentTime = 0;
  }

  function playMovementAlertSound() {
    if (!movementAudioRef.current || !soundEnabled) return;
    movementAudioRef.current.loop = true;
    movementAudioRef.current.currentTime = 0;
    movementAudioRef.current.play().catch((err) => {
      console.error("Movement alert sound failed:", err);
    });
  }

  function stopMovementAlertSound() {
    if (!movementAudioRef.current) return;
    movementAudioRef.current.pause();
    movementAudioRef.current.currentTime = 0;
  }

  async function acknowledgeAlarm(id: string) {
    const { data: userData } = await supabase.auth.getUser();

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user?.id)
      .maybeSingle();

    const name = profile?.full_name || userData.user?.email || "Dispatcher";

    const { error } = await supabase
      .from("alarms")
      .update({
        acknowledged: true,
        acknowledged_by: name,
        acknowledged_at: new Date().toISOString(),
        status: "Acknowledged",
      })
      .eq("id", id);

    if (error) {
      setStatusMessage(`Acknowledge error: ${error.message}`);
      return;
    }

    stopAlarmSound();
    setStatusMessage(`Acknowledged by ${name}`);
    await loadAlarms();
  }

  async function clearAlarm(id: string) {
    const { error } = await supabase
      .from("alarms")
      .update({
        status: "Cleared",
      })
      .eq("id", id);

    if (error) {
      setStatusMessage(`Clear error: ${error.message}`);
      return;
    }

    stopAlarmSound();
    setStatusMessage("Alarm cleared");
    await loadAlarms();
  }

  const liveTrackedUsers = useMemo(() => {
    return userLocations.filter(
      (u) =>
        u.latitude !== null &&
        u.longitude !== null &&
        isTrackedRecently(u.updated_at)
    );
  }, [userLocations]);

  const enableMovementMonitor = useCallback((user: UserLocation) => {
    setMovementWatch((prev) => ({
      ...prev,
      [user.user_id]: {
        enabled: true,
        baselineLat: user.latitude as number,
        baselineLng: user.longitude as number,
        baselineTime: new Date().toISOString(),
        alertActive: false,
      },
    }));
    setStatusMessage(`No movement monitor enabled for ${user.full_name || "user"}`);
  }, []);

  const disableMovementMonitor = useCallback((userId: string) => {
    setMovementWatch((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setStatusMessage("No movement monitor disabled");
  }, []);

  const resetMovementTimer = useCallback((userId: string) => {
    const trackingRow = liveTrackedUsers.find((u) => u.user_id === userId);
    if (!trackingRow) return;

    setMovementWatch((prev) => ({
      ...prev,
      [userId]: {
        enabled: true,
        baselineLat: trackingRow.latitude as number,
        baselineLng: trackingRow.longitude as number,
        baselineTime: new Date().toISOString(),
        alertActive: false,
      },
    }));

    setStatusMessage("Movement timer reset");
  }, [liveTrackedUsers]);

  useEffect(() => {
    setMovementWatch((prev) => {
      const next: Record<string, MovementWatchState> = { ...prev };
      const trackedIds = new Set(liveTrackedUsers.map((u) => u.user_id));

      Object.keys(next).forEach((userId) => {
        if (!trackedIds.has(userId)) {
          delete next[userId];
        }
      });

      for (const user of liveTrackedUsers) {
        const existing = next[user.user_id];
        if (!existing || !existing.enabled) continue;

        const distanceMoved = haversineDistanceMeters(
          existing.baselineLat,
          existing.baselineLng,
          user.latitude as number,
          user.longitude as number
        );

        if (distanceMoved >= MOVEMENT_THRESHOLD_METERS) {
          next[user.user_id] = {
            enabled: true,
            baselineLat: user.latitude as number,
            baselineLng: user.longitude as number,
            baselineTime: user.updated_at,
            alertActive: false,
          };
          continue;
        }

        const stationaryMs =
          Date.now() - new Date(existing.baselineTime).getTime();

        if (stationaryMs >= NO_MOVEMENT_LIMIT_MS && !existing.alertActive) {
          next[user.user_id] = {
            ...existing,
            alertActive: true,
          };
        }
      }

      return next;
    });
  }, [liveTrackedUsers]);

  const usersWithStatus = useMemo(() => {
    return presenceUsers.map((presenceUser) => {
      const online = isPresenceOnline(presenceUser);
      const trackingRow = liveTrackedUsers.find(
        (u) => u.user_id === presenceUser.user_id
      );
      const tracking = Boolean(trackingRow);
      const movement = movementWatch[presenceUser.user_id];

      return {
        ...presenceUser,
        online,
        tracking,
        trackingRow,
        movementMonitorEnabled: Boolean(movement?.enabled),
        movementAlertActive: Boolean(movement?.alertActive),
        stationaryMinutes:
          movement?.enabled ? minutesSince(movement.baselineTime) : 0,
      };
    });
  }, [liveTrackedUsers, movementWatch, presenceUsers]);

  const movementAlerts = useMemo(() => {
    return usersWithStatus.filter((u) => u.movementAlertActive);
  }, [usersWithStatus]);

  useEffect(() => {
    if (movementAlerts.length > 0) {
      playMovementAlertSound();
    } else {
      stopMovementAlertSound();
    }
  }, [movementAlerts.length, soundEnabled]);

  useEffect(() => {
    async function init() {
      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
        setStatusMessage("Not authenticated - please log in");
        return;
      }

      await loadAlarms();
      await loadUserLocations();
      await loadPresenceUsers();
      setStatusMessage(`Dispatcher live as ${userData.user.email}`);
    }

    init();

    const alarmsChannel = supabase
      .channel("dispatcher-alarms")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alarms" },
        async () => {
          await loadAlarms();
        }
      )
      .subscribe();

    const locationsChannel = supabase
      .channel("dispatcher-user-locations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_locations" },
        async () => {
          await loadUserLocations();
        }
      )
      .subscribe();

    const presenceChannel = supabase
      .channel("dispatcher-user-presence")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_presence" },
        async () => {
          await loadPresenceUsers();
        }
      )
      .subscribe();

    const pollInterval = setInterval(() => {
      loadAlarms();
      loadUserLocations();
      loadPresenceUsers();
    }, 10000);

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(alarmsChannel);
      supabase.removeChannel(locationsChannel);
      supabase.removeChannel(presenceChannel);
    };
  }, [loadAlarms, loadPresenceUsers, loadUserLocations]);

  useEffect(() => {
    if (!alarms.length || !soundEnabled || !alarmAudioRef.current) return;

    const newest = alarms[0];
    const isNewAlarm = newest.id !== lastAlarmId;
    const isActiveAlarm = newest.status === "Active";

    if (isNewAlarm && isActiveAlarm) {
      alarmAudioRef.current.loop = true;
      alarmAudioRef.current.currentTime = 0;
      alarmAudioRef.current.play().catch((err) => {
        console.error("Alarm play failed:", err);
        setStatusMessage("Alarm received but sound could not play.");
      });
    }

    setLastAlarmId(newest.id);
  }, [alarms, soundEnabled, lastAlarmId]);

  useEffect(() => {
    const active = alarms.find((a) => a.status === "Active");

    if (!active) {
      setFlashOn(false);
      return;
    }

    const interval = setInterval(() => {
      setFlashOn((prev) => !prev);
    }, 700);

    return () => clearInterval(interval);
  }, [alarms]);

  const activeAlarm = useMemo(() => {
    const active = alarms.filter((a) => a.status === "Active");
    if (!active.length) return undefined;

    return [...active].sort((a, b) => {
      const weightDiff =
        getAlarmPriorityWeight(b.alarm_type) -
        getAlarmPriorityWeight(a.alarm_type);

      if (weightDiff !== 0) return weightDiff;

      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    })[0];
  }, [alarms]);

  const historicalAlarms = useMemo(() => {
    return alarms.filter((a) => a.status !== "Active");
  }, [alarms]);

  const activeTheme = activeAlarm
    ? getAlarmTheme(activeAlarm.alarm_type)
    : null;

  const numberedLiveTrackedUsers = useMemo(() => {
    return liveTrackedUsers.map((user, index) => ({
      ...user,
      markerNumber: index + 1,
    }));
  }, [liveTrackedUsers]);

  const nearestResponder = useMemo(() => {
    if (
      !activeAlarm ||
      activeAlarm.latitude === null ||
      activeAlarm.longitude === null
    ) {
      return null;
    }

    const responders = numberedLiveTrackedUsers
      .filter((user) => user.user_id !== activeAlarm.triggered_by_user_id)
      .map((user) => {
        const distance = haversineDistanceMeters(
          activeAlarm.latitude as number,
          activeAlarm.longitude as number,
          user.latitude as number,
          user.longitude as number
        );

        return {
          ...user,
          distance,
        };
      })
      .sort((a, b) => a.distance - b.distance);

    return responders[0] || null;
  }, [activeAlarm, numberedLiveTrackedUsers]);

  const activeAlarmCount = alarms.filter((a) => a.status === "Active").length;

  return (
    <main
      className={`min-h-screen p-6 text-white transition-colors duration-300 ${
        activeAlarm && activeTheme && flashOn
          ? activeTheme.backdrop
          : "bg-black"
      }`}
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">DCS Dispatcher</h1>
            <p className="mt-1 text-sm text-slate-400">
              Live emergency control screen
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={enableSound}
              className={`rounded px-4 py-2 font-semibold ${
                soundEnabled
                  ? "bg-emerald-500 text-black"
                  : "bg-yellow-400 text-black"
              }`}
            >
              {soundEnabled ? "🔊 Sound Enabled" : "🔊 Enable Sound"}
            </button>

            <button
              onClick={() => {
                loadAlarms();
                loadUserLocations();
                loadPresenceUsers();
                setStatusMessage("Manual refresh complete");
              }}
              className="rounded bg-slate-700 px-4 py-2 font-semibold text-white"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Users Logged Into System</h2>
            <div className="text-sm text-slate-400">
              {usersWithStatus.length} users
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            {usersWithStatus.map((user) => (
              <div
                key={user.user_id}
                className="flex min-w-[180px] items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3"
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${
                    user.online ? "bg-emerald-600" : "bg-red-600"
                  }`}
                >
                  {(user.full_name || "U").charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0">
                  <div className="truncate font-semibold">
                    {user.full_name || "Unknown user"}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {user.role || "User"} · {user.site_name || "Unknown site"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`rounded px-2 py-1 ${
                        user.online
                          ? "bg-emerald-900/50 text-emerald-200"
                          : "bg-red-900/50 text-red-200"
                      }`}
                    >
                      {user.online ? "Logged in" : "Logged out"}
                    </span>

                    {user.tracking && (
                      <span className="rounded bg-blue-900/50 px-2 py-1 text-blue-200">
                        GPS Live
                      </span>
                    )}

                    {user.movementMonitorEnabled && (
                      <span className="rounded bg-cyan-900/50 px-2 py-1 text-cyan-200">
                        Monitor On
                      </span>
                    )}

                    {user.movementAlertActive && (
                      <span className="rounded bg-orange-900/50 px-2 py-1 text-orange-200">
                        No movement
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {movementAlerts.length > 0 && (
          <div className="mb-6 rounded-3xl border border-orange-500 bg-orange-950/30 p-6">
            <h2 className="mb-4 text-2xl font-semibold text-orange-200">
              No Movement Alerts
            </h2>

            <div className="space-y-3">
              {movementAlerts.map((user) => (
                <div
                  key={user.user_id}
                  className="flex flex-col gap-3 rounded-2xl border border-orange-700 bg-black/20 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="font-semibold">
                      {user.full_name || "Unknown user"}
                    </div>
                    <div className="text-sm text-orange-100/80">
                      No movement for approximately {user.stationaryMinutes} minutes
                    </div>
                    <div className="text-xs text-orange-100/70">
                      {user.role || "User"} · {user.site_name || "Unknown site"}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => resetMovementTimer(user.user_id)}
                      className="rounded bg-orange-500 px-4 py-2 font-semibold text-black"
                    >
                      Reset timer
                    </button>
                    <button
                      onClick={() => disableMovementMonitor(user.user_id)}
                      className="rounded bg-slate-800 px-4 py-2 font-semibold text-white"
                    >
                      Disable
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-slate-900 p-4">
            <div className="text-sm text-slate-400">System status</div>
            <div className="mt-1 text-lg font-semibold text-emerald-400">
              Live
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 p-4">
            <div className="text-sm text-slate-400">Active alarms</div>
            <div className="mt-1 text-lg font-semibold">
              {activeAlarmCount}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 p-4">
            <div className="text-sm text-slate-400">Live tracked users</div>
            <div className="mt-1 text-lg font-semibold">
              {numberedLiveTrackedUsers.length}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 p-4">
            <div className="text-sm text-slate-400">Nearest responder</div>
            <div className="mt-1 text-lg font-semibold">
              {nearestResponder
                ? `#${nearestResponder.markerNumber}`
                : "None"}
            </div>
          </div>
        </div>

        <div className="mb-6 rounded bg-slate-800 p-3 text-sm">
          {statusMessage}
        </div>

        {activeAlarm && activeTheme ? (
          <div
            className={`${activeTheme.panel} ${
              flashOn ? "ring-8" : "ring-0"
            } ${activeTheme.flashClass} mb-8 rounded-3xl p-8 transition-all duration-300`}
          >
            <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
              <div className="text-center lg:text-left">
                <h1 className="text-5xl font-black tracking-wide">
                  {activeTheme.title}
                </h1>

                <div className="mt-5 rounded-2xl bg-black/15 p-5">
                  <p className="text-3xl font-bold uppercase">
                    {activeAlarm.alarm_type}
                  </p>

                  <p className="mt-4 text-xl font-semibold">
                    👤 {activeAlarm.triggered_by_name || "Unknown user"}
                  </p>

                  <p className="mt-2 text-lg">
                    Role: {activeAlarm.triggered_by_role || "Unknown"}
                  </p>

                  <p className="mt-2 text-lg">
                    📍 {activeAlarm.location || "Unknown location"}
                  </p>

                  <p className="mt-2 text-lg">
                    🏢 {activeAlarm.site_name}
                  </p>

                  <p className="mt-2 text-lg">
                    🕒 {new Date(activeAlarm.created_at).toLocaleString()}
                  </p>

                  {activeAlarm.message && (
                    <p className="mt-4 text-lg font-medium">
                      {activeAlarm.message}
                    </p>
                  )}
                </div>

                {nearestResponder ? (
                  <div className="mt-4 rounded-2xl bg-black/20 p-4">
                    <p className="text-lg font-semibold">Nearest responder</p>
                    <p className="mt-2">
                      #{nearestResponder.markerNumber}{" "}
                      {nearestResponder.full_name || "Unknown user"} (
                      {nearestResponder.role || "User"})
                    </p>
                    <p className="mt-1">
                      Approx. {Math.round(nearestResponder.distance)}m away
                    </p>
                    <p className="mt-1 text-sm text-white/80">
                      Last updated:{" "}
                      {new Date(
                        nearestResponder.updated_at
                      ).toLocaleTimeString()}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl bg-black/20 p-4">
                    <p className="text-lg font-semibold">Nearest responder</p>
                    <p className="mt-2 text-white/80">
                      No other tracked responder currently available
                    </p>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap justify-center gap-4 lg:justify-start">
                  <button
                    onClick={() => acknowledgeAlarm(activeAlarm.id)}
                    className="rounded bg-white px-6 py-3 font-bold text-black"
                  >
                    Acknowledge
                  </button>

                  <button
                    onClick={() => clearAlarm(activeAlarm.id)}
                    className="rounded bg-black px-6 py-3 font-bold text-white"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div>
                {activeAlarm.latitude !== null &&
                activeAlarm.longitude !== null ? (
                  <AlarmMap
                    latitude={activeAlarm.latitude}
                    longitude={activeAlarm.longitude}
                    title={`${activeAlarm.alarm_type} alarm`}
                    subtitle={`${activeAlarm.triggered_by_name || "Unknown"} · ${activeAlarm.site_name}`}
                    kind="alarm"
                    extraMarkers={numberedLiveTrackedUsers.map((u) => ({
                      id: u.user_id,
                      latitude: u.latitude as number,
                      longitude: u.longitude as number,
                      title: `#${u.markerNumber} ${u.full_name || "User"}`,
                      subtitle: `${u.role || "User"} · ${u.site_name || ""}`,
                      kind: "user",
                      label: String(u.markerNumber),
                    }))}
                  />
                ) : (
                  <div className="flex h-[360px] items-center justify-center rounded-2xl border border-white/20 bg-black/20 p-6 text-center text-white/80">
                    No GPS location available for this alert
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-8 rounded-3xl bg-slate-900 p-10 text-center">
            <h1 className="text-4xl font-bold text-emerald-400">
              No Active Alerts
            </h1>
          </div>
        )}

        <div className="mb-8 rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Live User Map</h2>
            <div className="text-sm text-slate-400">
              {numberedLiveTrackedUsers.length} users currently tracked
            </div>
          </div>

          {numberedLiveTrackedUsers.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="overflow-hidden rounded-2xl">
                <AlarmMap
                  latitude={numberedLiveTrackedUsers[0].latitude as number}
                  longitude={numberedLiveTrackedUsers[0].longitude as number}
                  title={`#${numberedLiveTrackedUsers[0].markerNumber} ${
                    numberedLiveTrackedUsers[0].full_name || "Tracked user"
                  }`}
                  subtitle={`${numberedLiveTrackedUsers[0].role || "User"} · ${
                    numberedLiveTrackedUsers[0].site_name || ""
                  }`}
                  kind="user"
                  label={String(numberedLiveTrackedUsers[0].markerNumber)}
                  extraMarkers={numberedLiveTrackedUsers.slice(1).map((u) => ({
                    id: u.user_id,
                    latitude: u.latitude as number,
                    longitude: u.longitude as number,
                    title: `#${u.markerNumber} ${u.full_name || "Tracked user"}`,
                    subtitle: `${u.role || "User"} · ${u.site_name || ""}`,
                    kind: "user",
                    label: String(u.markerNumber),
                  }))}
                />
              </div>

              <div className="space-y-3">
                {numberedLiveTrackedUsers.map((user) => {
                  const monitor = movementWatch[user.user_id];
                  const monitorEnabled = Boolean(monitor?.enabled);
                  const alertActive = Boolean(monitor?.alertActive);
                  const idleMinutes = getIdleMinutesForUser(
                    user.user_id,
                    movementWatch
                  );

                  return (
                    <div
                      key={user.user_id}
                      className="relative rounded-2xl border border-slate-700 bg-slate-950/40 p-4"
                    >
                      <div
                        className={`absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full border-2 text-xs font-bold shadow-md ${getIdleBadgeClasses(
                          idleMinutes
                        )}`}
                        title={
                          monitorEnabled && idleMinutes !== null
                            ? `Idle for ${idleMinutes} minute${
                                idleMinutes === 1 ? "" : "s"
                              }`
                            : "No movement monitor disabled"
                        }
                      >
                        {formatIdleBadge(idleMinutes)}
                      </div>

                      <div className="pr-16 font-semibold">
                        #{user.markerNumber} {user.full_name || "Unknown user"}
                      </div>

                      <div className="mt-1 text-sm text-slate-300">
                        {user.role || "User"} · {user.site_name || "Unknown site"}
                      </div>

                      <div className="mt-1 text-sm text-slate-400">
                        {user.latitude?.toFixed(5)}, {user.longitude?.toFixed(5)}
                      </div>

                      {user.accuracy !== null && (
                        <div className="mt-1 text-xs text-slate-500">
                          Accuracy: {Math.round(user.accuracy)}m
                        </div>
                      )}

                      <div className="mt-1 text-xs text-slate-500">
                        Updated: {new Date(user.updated_at).toLocaleString()}
                      </div>

                      <div className="mt-2 text-xs">
                        {monitorEnabled ? (
                          <span className="rounded bg-cyan-900/50 px-2 py-1 text-cyan-200">
                            Idle timer running
                          </span>
                        ) : (
                          <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
                            Idle timer off
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {monitorEnabled ? (
                          <>
                            <button
                              onClick={() => resetMovementTimer(user.user_id)}
                              className="rounded bg-orange-500 px-3 py-1 text-xs font-semibold text-black"
                            >
                              Reset timer
                            </button>

                            <button
                              onClick={() => disableMovementMonitor(user.user_id)}
                              className="rounded bg-slate-800 px-3 py-1 text-xs font-semibold text-white"
                            >
                              Disable
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => enableMovementMonitor(user)}
                            className="rounded bg-cyan-500 px-3 py-1 text-xs font-semibold text-black"
                          >
                            Enable no movement alarm
                          </button>
                        )}

                        {alertActive && (
                          <span className="rounded bg-orange-900/50 px-2 py-1 text-xs text-orange-200">
                            Alert active
                          </span>
                        )}
                      </div>

                      <a
                        href={`https://www.google.com/maps?q=${user.latitude},${user.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block text-sm font-semibold underline"
                      >
                        Open map
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              No live tracked users yet
            </div>
          )}
        </div>

        <div className="mb-8 rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Historical Alarms</h2>
            <div className="text-sm text-slate-400">
              {historicalAlarms.length} historical alarms
            </div>
          </div>

          {historicalAlarms.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              No historical alarms yet
            </div>
          ) : (
            <div className="space-y-3">
              {historicalAlarms.map((alarm) => (
                <div
                  key={alarm.id}
                  className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-semibold">
                        {alarm.alarm_type} · {alarm.site_name}
                      </div>
                      <div className="mt-1 text-sm text-slate-300">
                        {alarm.message || "No message"}
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        Triggered by: {alarm.triggered_by_name || "Unknown"} (
                        {alarm.triggered_by_role || "Unknown"})
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        Location: {alarm.location || "Unknown"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Created: {new Date(alarm.created_at).toLocaleString()}
                      </div>
                    </div>

                    <div className="text-right text-xs text-slate-300">
                      <div>Status: {alarm.status}</div>
                      {alarm.acknowledged && (
                        <div className="mt-1">
                          Acknowledged by {alarm.acknowledged_by || "Unknown"}
                        </div>
                      )}
                      {alarm.acknowledged_at && (
                        <div className="mt-1 text-slate-500">
                          {new Date(alarm.acknowledged_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <audio ref={alarmAudioRef} src="/alarm.mp3" preload="auto" />
        <audio ref={movementAudioRef} src="/alarm.mp3" preload="auto" />
      </div>
    </main>
  );
}
