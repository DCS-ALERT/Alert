"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Alarm = {
  id: string;
  site_name: string;
  alarm_type: string;
  location: string | null;
  priority: string;
  status: string;
  message: string | null;
  created_at: string;
  triggered_by_name: string | null;
  triggered_by_role: string | null;
  acknowledged: boolean | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
};

function getAlarmTheme(alarmType: string) {
  const type = alarmType.toLowerCase();

  if (type === "panic") {
    return {
      panel: "bg-red-700",
      badge: "bg-red-200 text-red-900",
      title: "🚨 PANIC ALERT 🚨",
    };
  }

  if (type === "lockdown") {
    return {
      panel: "bg-purple-700",
      badge: "bg-purple-200 text-purple-900",
      title: "🔒 LOCKDOWN ALERT 🔒",
    };
  }

  if (type === "medical") {
    return {
      panel: "bg-blue-700",
      badge: "bg-blue-200 text-blue-900",
      title: "🏥 MEDICAL ALERT 🏥",
    };
  }

  if (type === "fire") {
    return {
      panel: "bg-orange-600",
      badge: "bg-orange-200 text-orange-900",
      title: "🔥 FIRE ALERT 🔥",
    };
  }

  return {
    panel: "bg-slate-700",
    badge: "bg-slate-200 text-slate-900",
    title: "⚠️ ALERT ⚠️",
  };
}

export default function DispatcherPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [statusMessage, setStatusMessage] = useState("Starting...");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [lastAlarmId, setLastAlarmId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function loadAlarms() {
    const { data, error } = await supabase
      .from("alarms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setStatusMessage(`Load error: ${error.message}`);
      return;
    }

    setAlarms(data || []);
  }

  function enableSound() {
    if (!audioRef.current) return;

    audioRef.current.volume = 1;
    audioRef.current.currentTime = 0;

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

    setStatusMessage("Alarm cleared");
  }

  useEffect(() => {
    loadAlarms();

    const channel = supabase
      .channel("dispatcher-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alarms" },
        () => loadAlarms()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!alarms.length || !soundEnabled || !audioRef.current) return;

    const newest = alarms[0];
    const isNewAlarm = newest.id !== lastAlarmId;
    const isActiveAlarm = newest.status === "Active";

    if (isNewAlarm && isActiveAlarm) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
        console.error("Alarm play failed:", err);
        setStatusMessage("Alarm received but sound could not play.");
      });
    }

    setLastAlarmId(newest.id);
  }, [alarms, soundEnabled, lastAlarmId]);

  const activeAlarm = useMemo(() => {
    return alarms.find((a) => a.status === "Active");
  }, [alarms]);

  const activeTheme = activeAlarm
    ? getAlarmTheme(activeAlarm.alarm_type)
    : null;

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">DCS Dispatcher</h1>

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
                audioRef.current?.play().catch((err) => console.error(err));
              }}
              className="rounded bg-blue-500 px-4 py-2 font-semibold text-white"
            >
              Test Sound
            </button>
          </div>
        </div>

        <div className="mb-6 rounded bg-slate-800 p-3 text-sm">
          {statusMessage}
        </div>

        {activeAlarm && activeTheme ? (
          <div className={`${activeTheme.panel} mb-8 rounded-3xl p-10 text-center`}>
            <h1 className="text-5xl font-bold">{activeTheme.title}</h1>

            <p className="mt-4 text-2xl">{activeAlarm.alarm_type}</p>
            <p className="mt-2">By: {activeAlarm.triggered_by_name || "Unknown"}</p>
            <p>Role: {activeAlarm.triggered_by_role || "Unknown"}</p>
            <p>Location: {activeAlarm.location || "Unknown"}</p>
            <p>Site: {activeAlarm.site_name}</p>

            <p className="mt-2">
              {new Date(activeAlarm.created_at).toLocaleString()}
            </p>

            {activeAlarm.latitude && activeAlarm.longitude && (
              <div className="mt-4">
                <p>
                  GPS: {activeAlarm.latitude.toFixed(5)},{" "}
                  {activeAlarm.longitude.toFixed(5)}
                </p>

                {activeAlarm.location_accuracy && (
                  <p>Accuracy: {Math.round(activeAlarm.location_accuracy)}m</p>
                )}

                <a
                  href={`https://www.google.com/maps?q=${activeAlarm.latitude},${activeAlarm.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block font-semibold underline text-white"
                >
                  Open in Google Maps
                </a>
              </div>
            )}

            <div className="mt-6 flex justify-center gap-4">
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
        ) : (
          <div className="mb-8 rounded-3xl bg-slate-900 p-10 text-center">
            <h1 className="text-4xl font-bold text-emerald-400">
              No Active Alerts
            </h1>
          </div>
        )}

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

                    <p>
                      {alarm.triggered_by_name || "Unknown"} (
                      {alarm.triggered_by_role || "Unknown"})
                    </p>

                    <p>Site: {alarm.site_name}</p>
                    <p>Status: {alarm.status}</p>

                    {alarm.latitude && alarm.longitude && (
                      <p className="text-sm text-slate-400">
                        GPS: {alarm.latitude.toFixed(5)}, {alarm.longitude.toFixed(5)}
                      </p>
                    )}

                    {alarm.acknowledged && (
                      <p className="text-sm text-emerald-400">
                        Acknowledged by {alarm.acknowledged_by || "Unknown"} at{" "}
                        {alarm.acknowledged_at
                          ? new Date(alarm.acknowledged_at).toLocaleString()
                          : "-"}
                      </p>
                    )}

                    <p className="text-sm">
                      {new Date(alarm.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${theme.badge}`}>
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
