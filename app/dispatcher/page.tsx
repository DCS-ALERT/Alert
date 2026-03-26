"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function getAlarmTheme(alarmType: string) {
  const type = alarmType.toLowerCase();

  if (type === "panic") {
    return {
      panel: "bg-red-700",
      badge: "bg-red-200 text-red-900",
      title: "🚨 PANIC ALERT 🚨",
      flashClass: "ring-red-300/70",
      backdrop: "bg-red-950/35",
    };
  }

  if (type === "lockdown") {
    return {
      panel: "bg-purple-700",
      badge: "bg-purple-200 text-purple-900",
      title: "🔒 LOCKDOWN ALERT 🔒",
      flashClass: "ring-purple-300/70",
      backdrop: "bg-purple-950/35",
    };
  }

  if (type === "medical") {
    return {
      panel: "bg-blue-700",
      badge: "bg-blue-200 text-blue-900",
      title: "🏥 MEDICAL ALERT 🏥",
      flashClass: "ring-blue-300/70",
      backdrop: "bg-blue-950/35",
    };
  }

  if (type === "fire") {
    return {
      panel: "bg-orange-600",
      badge: "bg-orange-200 text-orange-900",
      title: "🔥 FIRE ALERT 🔥",
      flashClass: "ring-orange-300/70",
      backdrop: "bg-orange-950/35",
    };
  }

  return {
    panel: "bg-slate-700",
    badge: "bg-slate-200 text-slate-900",
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

export default function DispatcherPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [userLocations, setUserLocations] = useState<UserLocation[]>([]);
  const [statusMessage, setStatusMessage] = useState("Starting...");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [lastAlarmId, setLastAlarmId] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function loadAlarms() {
    const { data, error } = await supabase
      .from("alarms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setStatusMessage(`Load alarms error: ${error.message}`);
      return;
    }

    setAlarms(data || []);
  }

  async function loadUserLocations() {
    const { data, error } = await supabase
      .from("user_locations")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      setStatusMessage(`Load user locations error: ${error.message}`);
      return;
    }

    setUserLocations(data || []);
  }

  function enableSound() {
    if (!audioRef.current) return;

    audioRef.current.volume = 1;
    audioRef.current.currentTime = 0;
    audioRef.current.loop = true;

    audioRef.current
      .play()
      .then(() => {
        if (!audioRef.current) return;
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setSoundEnabled(true);
        setStatusMessage("Dispatcher sound enabled");
      })
      .catch((err) => {
        console.error("Sound enable failed:", err);
        setStatusMessage("Browser blocked audio. Tap Enable Sound again.");
      });
  }

  function stopAlarmSound() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
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
  }

  async function clearAlarm(id: string) {
    const { error } = await supabase
      .from("alarms")
      .update({ status: "Cleared" })
      .eq("id", id);

    if (error) {
      setStatusMessage(`Clear error: ${error.message}`);
      return;
    }

    stopAlarmSound();
    setStatusMessage("Alarm cleared");
  }

  useEffect(() => {
    loadAlarms();
    loadUserLocations();

    const alarmsChannel = supabase
      .channel("dispatcher-alarms")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alarms" },
        () => loadAlarms()
      )
      .subscribe();

    const locationsChannel = supabase
      .channel("dispatcher-user-locations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_locations" },
        () => loadUserLocations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(alarmsChannel);
      supabase.removeChannel(locationsChannel);
    };
  }, []);

  useEffect(() => {
    if (!alarms.length || !soundEnabled || !audioRef.current) return;

    const newest = alarms[0];
    const isNewAlarm = newest.id !== lastAlarmId;
    const isActiveAlarm = newest.status === "Active";

    if (isNewAlarm && isActiveAlarm) {
      audioRef.current.loop = true;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
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

  const activeTheme = activeAlarm
    ? getAlarmTheme(activeAlarm.alarm_type)
    : null;

  const activeTrackedAlarms = useMemo(() => {
    return alarms.filter(
      (a) =>
        a.status === "Active" &&
        a.latitude !== null &&
        a.longitude !== null
    );
  }, [alarms]);

  const liveTrackedUsers = useMemo(() => {
    return userLocations.filter(
      (u) => u.latitude !== null && u.longitude !== null
    );
  }, [userLocations]);

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
                if (!audioRef.current) return;
                audioRef.current.loop = false;
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch((err) => console.error(err));
              }}
              className="rounded bg-blue-500 px-4 py-2 font-semibold text-white"
            >
              Test Sound
            </button>
          </div>
        </div>

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
            <div className="text-sm text-slate-400">Alarm GPS points</div>
            <div className="mt-1 text-lg font-semibold">
              {activeTrackedAlarms.length}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 p-4">
            <div className="text-sm text-slate-400">Live tracked users</div>
            <div className="mt-1 text-lg font-semibold">
              {numberedLiveTrackedUsers.length}
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

                {activeAlarm.latitude !== null &&
                  activeAlarm.longitude !== null && (
                    <div className="mt-4 rounded-2xl bg-black/15 p-4">
                      <p>
                        GPS: {activeAlarm.latitude.toFixed(5)},{" "}
                        {activeAlarm.longitude.toFixed(5)}
                      </p>

                      {activeAlarm.location_accuracy !== null && (
                        <p className="mt-1">
                          Accuracy: {Math.round(activeAlarm.location_accuracy)}m
                        </p>
                      )}

                      <a
                        href={`https://www.google.com/maps?q=${activeAlarm.latitude},${activeAlarm.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block font-semibold underline text-white"
                      >
                        Open in Google Maps
                      </a>
                    </div>
                  )}

                {nearestResponder ? (
                  <div className="mt-4 rounded-2xl bg-black/20 p-4">
                    <p className="text-lg font-semibold">
                      Nearest responder
                    </p>
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
                      {new Date(nearestResponder.updated_at).toLocaleTimeString()}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl bg-black/20 p-4">
                    <p className="text-lg font-semibold">
                      Nearest responder
                    </p>
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
                {numberedLiveTrackedUsers.map((user) => (
                  <div
                    key={user.user_id}
                    className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4"
                  >
                    <div className="font-semibold">
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
                    <a
                      href={`https://www.google.com/maps?q=${user.latitude},${user.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-sm font-semibold underline"
                    >
                      Open map
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              No live tracked users yet
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-4 text-xl">All Alarms</h2>

          {alarms.map((alarm) => {
            const theme = getAlarmTheme(alarm.alarm_type);

            return (
              <div
                key={alarm.id}
                className="mb-3 rounded border border-gray-700 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-bold">
                      {alarm.alarm_type} - {alarm.location || "Unknown location"}
                    </p>

                    <p className="mt-1">
                      {alarm.triggered_by_name || "Unknown"} (
                      {alarm.triggered_by_role || "Unknown"})
                    </p>

                    <p className="mt-1">Site: {alarm.site_name}</p>
                    <p className="mt-1">Status: {alarm.status}</p>

                    {alarm.latitude !== null && alarm.longitude !== null && (
                      <p className="mt-1 text-sm text-slate-400">
                        GPS: {alarm.latitude.toFixed(5)},{" "}
                        {alarm.longitude.toFixed(5)}
                      </p>
                    )}

                    {alarm.acknowledged && (
                      <p className="mt-1 text-sm text-emerald-400">
                        Acknowledged by {alarm.acknowledged_by || "Unknown"} at{" "}
                        {alarm.acknowledged_at
                          ? new Date(alarm.acknowledged_at).toLocaleString()
                          : "-"}
                      </p>
                    )}

                    <p className="mt-1 text-sm">
                      {new Date(alarm.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${theme.badge}`}
                    >
                      {alarm.alarm_type}
                    </span>

                    {alarm.status === "Active" && (
                      <button
                        onClick={() => acknowledgeAlarm(alarm.id)}
                        className="rounded bg-white px-3 py-2 text-sm font-semibold text-black"
                      >
                        Acknowledge
                      </button>
                    )}

                    {alarm.status !== "Cleared" && (
                      <button
                        onClick={() => clearAlarm(alarm.id)}
                        className="rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <audio ref={audioRef} src="/alarm.mp3" preload="auto" />
      </div>
    </main>
  );
}
