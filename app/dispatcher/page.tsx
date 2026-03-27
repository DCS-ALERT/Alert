"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";

const AlarmMap = dynamic(() => import("@/components/AlarmMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded-2xl border border-white/15 bg-black/20 p-6 text-center text-white/80">
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

type MovementMonitorRow = {
  user_id: string;
  enabled: boolean;
  baseline_lat: number | null;
  baseline_lng: number | null;
  baseline_time: string | null;
  alert_active: boolean | null;
  updated_at: string | null;
};

type MovementWatchState = {
  enabled: boolean;
  baselineLat: number;
  baselineLng: number;
  baselineTime: string;
  alertActive: boolean;
};

type ProfileRole = "user" | "supervisor" | "dispatcher" | "admin" | "unknown";

function normaliseRole(role: string | null | undefined): ProfileRole {
  const value = (role || "").trim().toLowerCase();
  if (value === "user") return "user";
  if (value === "supervisor") return "supervisor";
  if (value === "dispatcher") return "dispatcher";
  if (value === "admin") return "admin";
  return "unknown";
}

function canAccessDispatcher(role: string | null | undefined) {
  const normalised = normaliseRole(role);
  return (
    normalised === "supervisor" ||
    normalised === "dispatcher" ||
    normalised === "admin"
  );
}

async function writeAuditLog(params: {
  actionType: string;
  targetType: string;
  targetId?: string | null;
  targetName?: string | null;
  siteName?: string | null;
  details?: Record<string, unknown>;
}) {
  const { data: userData } = await supabase.auth.getUser();

  let performedByName = "Dispatcher";
  let performedByUserId: string | null = userData.user?.id || null;

  if (userData.user?.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userData.user.id)
      .maybeSingle();

    performedByName =
      profile?.full_name || userData.user.email || "Dispatcher";
  }

  const { error } = await supabase.from("audit_log").insert([
    {
      action_type: params.actionType,
      target_type: params.targetType,
      target_id: params.targetId || null,
      target_name: params.targetName || null,
      performed_by_user_id: performedByUserId,
      performed_by_name: performedByName,
      site_name: params.siteName || null,
      details: params.details || {},
    },
  ]);

  if (error) {
    console.error("Audit log write failed:", error);
  }
}

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
    return "bg-amber-400 text-black border-amber-100";
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
  const [movementWatch, setMovementWatch] = useState<
    Record<string, MovementWatchState>
  >({});
  const [statusMessage, setStatusMessage] = useState("Starting...");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [lastAlarmId, setLastAlarmId] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const movementLoopRef = useRef<number | null>(null);
  const alarmLoopRef = useRef<number | null>(null);

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

  const loadMovementMonitor = useCallback(async () => {
    const { data, error } = await supabase.from("movement_monitor").select("*");

    if (error) {
      setStatusMessage(`Load movement monitor error: ${error.message}`);
      return;
    }

    const map: Record<string, MovementWatchState> = {};

    ((data || []) as MovementMonitorRow[]).forEach((row) => {
      if (
        row.enabled &&
        row.baseline_lat !== null &&
        row.baseline_lng !== null &&
        row.baseline_time
      ) {
        map[row.user_id] = {
          enabled: row.enabled,
          baselineLat: Number(row.baseline_lat),
          baselineLng: Number(row.baseline_lng),
          baselineTime: row.baseline_time,
          alertActive: Boolean(row.alert_active),
        };
      }
    });

    setMovementWatch(map);
  }, []);

  const playSingleBeep = useCallback(
    (
      frequency = 880,
      durationMs = 180,
      volume = 0.06,
      type: OscillatorType = "sine"
    ) => {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        volume,
        ctx.currentTime + 0.01
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + durationMs / 1000
      );

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + durationMs / 1000 + 0.03);
    },
    []
  );

  const stopAlarmSound = useCallback(() => {
    if (alarmLoopRef.current !== null) {
      window.clearInterval(alarmLoopRef.current);
      alarmLoopRef.current = null;
    }
  }, []);

  const stopMovementAlertSound = useCallback(() => {
    if (movementLoopRef.current !== null) {
      window.clearInterval(movementLoopRef.current);
      movementLoopRef.current = null;
    }
  }, []);

  const playAlarmSound = useCallback(() => {
    if (!soundEnabled) return;
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== "running") {
      setStatusMessage("Alarm received but audio is not unlocked. Click Enable Sound.");
      return;
    }

    if (alarmLoopRef.current !== null) return;

    const playPattern = () => {
      playSingleBeep(920, 180, 0.08, "square");
      window.setTimeout(() => playSingleBeep(720, 180, 0.08, "square"), 220);
    };

    playPattern();
    alarmLoopRef.current = window.setInterval(playPattern, 1100);
  }, [playSingleBeep, soundEnabled]);

  const playMovementAlertSound = useCallback(() => {
    if (!soundEnabled) return;
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== "running") {
      setStatusMessage(
        "Movement alert triggered but audio is not unlocked. Click Enable Sound."
      );
      return;
    }

    if (movementLoopRef.current !== null) return;

    const playPattern = () => {
      playSingleBeep(660, 140, 0.05, "triangle");
    };

    playPattern();
    movementLoopRef.current = window.setInterval(playPattern, 1400);
  }, [playSingleBeep, soundEnabled]);

  async function enableSound() {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (!AudioContextClass) {
        setStatusMessage("This browser does not support Web Audio.");
        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      if (audioContextRef.current.state !== "running") {
        await audioContextRef.current.resume();
      }

      playSingleBeep(880, 120, 0.04, "sine");

      setSoundEnabled(true);
      setStatusMessage("Dispatcher sound enabled");
    } catch (err) {
      console.error("Sound enable failed:", err);
      setSoundEnabled(false);
      setStatusMessage(
        "Browser blocked audio. Click Enable Sound again and keep this tab active."
      );
    }
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

    const alarmRow = alarms.find((a) => a.id === id);

    await writeAuditLog({
      actionType: "acknowledge_alarm",
      targetType: "alarm",
      targetId: id,
      targetName: alarmRow?.alarm_type || "Alarm",
      siteName: alarmRow?.site_name || null,
      details: {
        status: "Acknowledged",
      },
    });

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

    const alarmRow = alarms.find((a) => a.id === id);

    await writeAuditLog({
      actionType: "clear_alarm",
      targetType: "alarm",
      targetId: id,
      targetName: alarmRow?.alarm_type || "Alarm",
      siteName: alarmRow?.site_name || null,
      details: {
        status: "Cleared",
      },
    });

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

  const enableMovementMonitor = useCallback(
    async (user: UserLocation) => {
      const { error } = await supabase.from("movement_monitor").upsert([
        {
          user_id: user.user_id,
          enabled: true,
          baseline_lat: user.latitude,
          baseline_lng: user.longitude,
          baseline_time: new Date().toISOString(),
          alert_active: false,
          updated_at: new Date().toISOString(),
        },
      ]);

      if (error) {
        setStatusMessage(`Enable monitor error: ${error.message}`);
        return;
      }

      await writeAuditLog({
        actionType: "enable_movement_monitor",
        targetType: "user",
        targetId: user.user_id,
        targetName: user.full_name || "Unknown user",
        siteName: user.site_name || null,
        details: {
          latitude: user.latitude,
          longitude: user.longitude,
          baselineTime: new Date().toISOString(),
        },
      });

      setStatusMessage(
        `Monitor enabled for ${user.full_name || "Unknown user"}`
      );
      await loadMovementMonitor();
    },
    [loadMovementMonitor]
  );

  const resetMovementTimer = useCallback(
    async (userId: string) => {
      const trackingRow = liveTrackedUsers.find((u) => u.user_id === userId);
      if (!trackingRow) return;

      const { error } = await supabase
        .from("movement_monitor")
        .update({
          baseline_lat: trackingRow.latitude,
          baseline_lng: trackingRow.longitude,
          baseline_time: new Date().toISOString(),
          alert_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) {
        setStatusMessage(`Reset error: ${error.message}`);
        return;
      }

      await writeAuditLog({
        actionType: "reset_movement_monitor",
        targetType: "user",
        targetId: userId,
        targetName: trackingRow?.full_name || "Unknown user",
        siteName: trackingRow?.site_name || null,
        details: {
          latitude: trackingRow?.latitude || null,
          longitude: trackingRow?.longitude || null,
          baselineTime: new Date().toISOString(),
        },
      });

      setStatusMessage("Timer reset");
      await loadMovementMonitor();
    },
    [liveTrackedUsers, loadMovementMonitor]
  );

  const disableMovementMonitor = useCallback(
    async (userId: string) => {
      const { error } = await supabase
        .from("movement_monitor")
        .update({
          enabled: false,
          alert_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) {
        setStatusMessage(`Disable error: ${error.message}`);
        return;
      }

      const trackedUser = liveTrackedUsers.find((u) => u.user_id === userId);
      const presenceUser = presenceUsers.find((u) => u.user_id === userId);

      await writeAuditLog({
        actionType: "disable_movement_monitor",
        targetType: "user",
        targetId: userId,
        targetName:
          trackedUser?.full_name || presenceUser?.full_name || "Unknown user",
        siteName: trackedUser?.site_name || presenceUser?.site_name || null,
        details: {
          disabledAt: new Date().toISOString(),
        },
      });

      setStatusMessage("Monitor disabled");
      await loadMovementMonitor();
    },
    [liveTrackedUsers, presenceUsers, loadMovementMonitor]
  );

  useEffect(() => {
    const checkNoMovement = async () => {
      for (const user of liveTrackedUsers) {
        const existing = movementWatch[user.user_id];
        if (!existing || !existing.enabled) continue;

        const distanceMoved = haversineDistanceMeters(
          existing.baselineLat,
          existing.baselineLng,
          user.latitude as number,
          user.longitude as number
        );

        if (distanceMoved >= MOVEMENT_THRESHOLD_METERS) {
          await supabase
            .from("movement_monitor")
            .update({
              baseline_lat: user.latitude,
              baseline_lng: user.longitude,
              baseline_time: user.updated_at,
              alert_active: false,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.user_id);

          continue;
        }

        const stationaryMs =
          Date.now() - new Date(existing.baselineTime).getTime();

        if (stationaryMs >= NO_MOVEMENT_LIMIT_MS && !existing.alertActive) {
          await supabase
            .from("movement_monitor")
            .update({
              alert_active: true,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.user_id);
        }
      }
    };

    if (hasAccess) {
      checkNoMovement();
    }
  }, [liveTrackedUsers, movementWatch, hasAccess]);

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
  }, [movementAlerts.length, playMovementAlertSound, stopMovementAlertSound]);

  useEffect(() => {
    async function init() {
      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
        window.location.href = "/login";
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (!canAccessDispatcher(profile?.role)) {
        setAccessChecked(true);
        setHasAccess(false);
        setStatusMessage("Access denied");
        return;
      }

      setHasAccess(true);
      setAccessChecked(true);

      await loadAlarms();
      await loadUserLocations();
      await loadPresenceUsers();
      await loadMovementMonitor();
      setStatusMessage(`Dispatcher live as ${userData.user.email}`);
    }

    init();

    const alarmsChannel = supabase
      .channel("dispatcher-alarms")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alarms" },
        async () => {
          if (hasAccess) await loadAlarms();
        }
      )
      .subscribe();

    const locationsChannel = supabase
      .channel("dispatcher-user-locations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_locations" },
        async () => {
          if (hasAccess) await loadUserLocations();
        }
      )
      .subscribe();

    const presenceChannel = supabase
      .channel("dispatcher-user-presence")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_presence" },
        async () => {
          if (hasAccess) await loadPresenceUsers();
        }
      )
      .subscribe();

    const monitorChannel = supabase
      .channel("movement-monitor")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "movement_monitor" },
        async () => {
          if (hasAccess) await loadMovementMonitor();
        }
      )
      .subscribe();

    const pollInterval = setInterval(() => {
      if (hasAccess) {
        loadAlarms();
        loadUserLocations();
        loadPresenceUsers();
        loadMovementMonitor();
      }
    }, 10000);

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(alarmsChannel);
      supabase.removeChannel(locationsChannel);
      supabase.removeChannel(presenceChannel);
      supabase.removeChannel(monitorChannel);
      stopAlarmSound();
      stopMovementAlertSound();
    };
  }, [
    hasAccess,
    loadAlarms,
    loadPresenceUsers,
    loadUserLocations,
    loadMovementMonitor,
    stopAlarmSound,
    stopMovementAlertSound,
  ]);

  useEffect(() => {
    if (!alarms.length || !soundEnabled) return;

    const newest = alarms[0];
    const isNewAlarm = newest.id !== lastAlarmId;
    const isActiveAlarm = newest.status === "Active";

    if (isNewAlarm && isActiveAlarm) {
      playAlarmSound();
      setStatusMessage("Alarm sounding");
    }

    setLastAlarmId(newest.id);
  }, [alarms, soundEnabled, lastAlarmId, playAlarmSound]);

  useEffect(() => {
    const active = alarms.find((a) => a.status === "Active");

    if (!active) {
      setFlashOn(false);
      stopAlarmSound();
      return;
    }

    const interval = setInterval(() => {
      setFlashOn((prev) => !prev);
    }, 700);

    return () => clearInterval(interval);
  }, [alarms, stopAlarmSound]);

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

  if (!accessChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="rounded-3xl border border-white/10 bg-slate-900 px-8 py-6 text-center shadow-xl">
          <div className="text-lg font-semibold">Checking access…</div>
        </div>
      </main>
    );
  }

  if (!hasAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="max-w-md rounded-3xl border border-red-500/30 bg-slate-900 px-8 py-6 text-center shadow-xl">
          <h1 className="text-2xl font-bold text-red-300">Access denied</h1>
          <p className="mt-3 text-sm text-slate-300">
            Your role does not have permission to access the dispatcher.
          </p>
          <a
            href="/"
            className="mt-5 inline-block rounded-xl bg-white px-4 py-2 font-semibold text-black"
          >
            Back to dashboard
          </a>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`min-h-screen p-6 text-white transition-colors duration-300 ${
        activeAlarm && activeTheme && flashOn
          ? activeTheme.backdrop
          : "bg-black"
      }`}
    >
      <div className="mx-auto max-w-7xl">
        <div className="sticky top-0 z-20 mb-6 rounded-3xl border border-white/10 bg-slate-950/90 p-4 shadow-xl backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                DCS Dispatcher
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Live emergency control screen
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={enableSound}
                className={`rounded-xl px-4 py-2 font-semibold transition ${
                  soundEnabled
                    ? "bg-emerald-400 text-black"
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
                  loadMovementMonitor();
                  setStatusMessage("Manual refresh complete");
                }}
                className="rounded-xl bg-slate-700 px-4 py-2 font-semibold text-white transition hover:bg-slate-600"
              >
                Refresh
              </button>

              <a
                href="/dispatcher/history"
                className="rounded-xl bg-slate-700 px-4 py-2 font-semibold text-white transition hover:bg-slate-600"
              >
                Alarm History
              </a>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-lg">
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
                className="flex min-w-[210px] items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3 shadow-sm"
              >
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold shadow-md ${
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
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`rounded-full px-2.5 py-1 ${
                        user.online
                          ? "bg-emerald-900/50 text-emerald-200"
                          : "bg-red-900/50 text-red-200"
                      }`}
                    >
                      {user.online ? "Logged in" : "Logged out"}
                    </span>

                    {user.tracking && (
                      <span className="rounded-full bg-blue-900/50 px-2.5 py-1 text-blue-200">
                        GPS Live
                      </span>
                    )}

                    {user.movementMonitorEnabled && (
                      <span className="rounded-full bg-cyan-900/50 px-2.5 py-1 text-cyan-200">
                        Monitor On
                      </span>
                    )}

                    {user.movementAlertActive && (
                      <span className="rounded-full bg-orange-900/50 px-2.5 py-1 text-orange-200">
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
          <div className="mb-6 rounded-3xl border border-orange-500/50 bg-orange-950/30 p-6 shadow-lg">
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
                      className="rounded-xl bg-orange-400 px-4 py-2 font-semibold text-black"
                    >
                      Reset timer
                    </button>
                    <button
                      onClick={() => disableMovementMonitor(user.user_id)}
                      className="rounded-xl bg-slate-800 px-4 py-2 font-semibold text-white"
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
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-sm">
            <div className="text-sm text-slate-400">System status</div>
            <div className="mt-1 text-lg font-semibold text-emerald-400">
              Live
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-sm">
            <div className="text-sm text-slate-400">Active alarms</div>
            <div className="mt-1 text-lg font-semibold">
              {activeAlarmCount}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-sm">
            <div className="text-sm text-slate-400">Live tracked users</div>
            <div className="mt-1 text-lg font-semibold">
              {numberedLiveTrackedUsers.length}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-sm">
            <div className="text-sm text-slate-400">Nearest responder</div>
            <div className="mt-1 text-lg font-semibold">
              {nearestResponder
                ? `#${nearestResponder.markerNumber}`
                : "None"}
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-white/10 bg-slate-900 p-3 text-sm shadow-sm">
          {statusMessage}
        </div>

        {activeAlarm && activeTheme ? (
          <div
            className={`${activeTheme.panel} ${
              flashOn ? "ring-8" : "ring-0"
            } ${activeTheme.flashClass} mb-8 rounded-3xl p-8 shadow-2xl transition-all duration-300`}
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
                    className="rounded-xl bg-white px-6 py-3 font-bold text-black shadow-sm"
                  >
                    Acknowledge
                  </button>

                  <button
                    onClick={() => clearAlarm(activeAlarm.id)}
                    className="rounded-xl bg-black px-6 py-3 font-bold text-white shadow-sm"
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
          <div className="mb-8 rounded-3xl border border-white/10 bg-slate-900 p-10 text-center shadow-lg">
            <h1 className="text-4xl font-bold text-emerald-400">
              No Active Alerts
            </h1>
          </div>
        )}

        <div className="mb-8 rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Live User Map</h2>
            <div className="text-sm text-slate-400">
              {numberedLiveTrackedUsers.length} users currently tracked
            </div>
          </div>

          {numberedLiveTrackedUsers.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
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
                      className="relative rounded-2xl border border-slate-700 bg-slate-950/50 p-4 shadow-sm transition hover:border-slate-500"
                    >
                      <div
                        className={`absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full border-2 text-xs font-bold shadow-md transition-colors ${getIdleBadgeClasses(
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
                          <span className="rounded-full bg-cyan-900/50 px-2.5 py-1 text-cyan-200">
                            Idle timer running
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">
                            Idle timer off
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {monitorEnabled ? (
                          <>
                            <button
                              onClick={() => resetMovementTimer(user.user_id)}
                              className="rounded-xl bg-orange-400 px-3 py-1 text-xs font-semibold text-black"
                            >
                              Reset timer
                            </button>

                            <button
                              onClick={() => disableMovementMonitor(user.user_id)}
                              className="rounded-xl bg-slate-800 px-3 py-1 text-xs font-semibold text-white"
                            >
                              Disable
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => enableMovementMonitor(user)}
                            className="rounded-xl bg-cyan-400 px-3 py-1 text-xs font-semibold text-black"
                          >
                            Enable no movement alarm
                          </button>
                        )}

                        {alertActive && (
                          <span className="rounded-full bg-orange-900/50 px-2.5 py-1 text-xs text-orange-200">
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
      </div>
    </main>
  );
}
