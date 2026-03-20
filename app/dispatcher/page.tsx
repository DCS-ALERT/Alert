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
};

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
    if (audioRef.current) {
      audioRef.current
        .play()
        .then(() => {
          audioRef.current?.pause();
          audioRef.current.currentTime = 0;
          setSoundEnabled(true);
        })
        .catch(() => {
          alert("Click again to enable sound");
        });
    }
  }

  async function acknowledgeAlarm(id: string) {
    const { data: userData } = await supabase.auth.getUser();

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user?.id)
      .maybeSingle();

    const name =
      profile?.full_name || userData.user?.email || "Dispatcher";

    await supabase
      .from("alarms")
      .update({
        acknowledged: true,
        acknowledged_by: name,
        acknowledged_at: new Date().toISOString(),
        status: "Acknowledged",
      })
      .eq("id", id);

    setStatusMessage(`Acknowledged by ${name}`);
  }

  async function clearAlarm(id: string) {
    await supabase
      .from("alarms")
      .update({ status: "Cleared" })
      .eq("id", id);

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

  // 🔊 PLAY SOUND ON NEW CRITICAL ALARM
  useEffect(() => {
    if (!alarms.length) return;

    const newest = alarms[0];

    if (
      soundEnabled &&
      newest.id !== lastAlarmId &&
      newest.status === "Active" &&
      (newest.priority === "Critical" || newest.alarm_type === "Panic")
    ) {
      audioRef.current?.play().catch(() => {});
    }

    setLastAlarmId(newest.id);
  }, [alarms, soundEnabled]);

  const activeCritical = useMemo(() => {
    return alarms.find(
      (a) =>
        a.status === "Active" &&
        (a.priority === "Critical" || a.alarm_type === "Panic")
    );
  }, [alarms]);

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="mx-auto max-w-6xl">

        {/* HEADER */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">DCS Dispatcher</h1>

          <button
            onClick={enableSound}
            className={`px-4 py-2 rounded font-semibold ${
              soundEnabled
                ? "bg-emerald-500 text-black"
                : "bg-yellow-400 text-black"
            }`}
          >
            {soundEnabled ? "🔊 Sound Enabled" : "🔊 Enable Sound"}
          </button>
        </div>

        {/* STATUS */}
        <div className="mb-6 bg-slate-800 p-3 rounded text-sm">
          {statusMessage}
        </div>

        {/* 🚨 EMERGENCY PANEL */}
        {activeCritical && (
          <div className="bg-red-700 p-10 rounded-3xl text-center mb-8">
            <h1 className="text-5xl font-bold">🚨 EMERGENCY 🚨</h1>

            <p className="mt-4 text-2xl">
              {activeCritical.alarm_type}
            </p>

            <p className="mt-2">
              By: {activeCritical.triggered_by_name}
            </p>

            <p>Role: {activeCritical.triggered_by_role}</p>
            <p>Location: {activeCritical.location}</p>
            <p>Site: {activeCritical.site_name}</p>

            <p className="mt-2">
              {new Date(activeCritical.created_at).toLocaleString()}
            </p>

            <div className="mt-6 flex justify-center gap-4">
              <button
                onClick={() => acknowledgeAlarm(activeCritical.id)}
                className="bg-white text-black px-6 py-3 rounded font-bold"
              >
                Acknowledge
              </button>

              <button
                onClick={() => clearAlarm(activeCritical.id)}
                className="bg-black text-white px-6 py-3 rounded font-bold"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* LIST */}
        <div>
          <h2 className="text-xl mb-4">All Alarms</h2>

          {alarms.map((alarm) => (
            <div
              key={alarm.id}
              className="mb-3 border border-gray-700 p-4 rounded"
            >
              <p className="font-bold">
                {alarm.alarm_type} - {alarm.location}
              </p>

              <p>
                {alarm.triggered_by_name} ({alarm.triggered_by_role})
              </p>

              <p>Status: {alarm.status}</p>

              <p className="text-sm">
                {new Date(alarm.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        {/* AUDIO */}
        <audio
          ref={audioRef}
          src="https://actions.google.com/sounds/v1/emergency/emergency_siren.ogg"
          preload="auto"
        />
      </div>
    </main>
  );
}
