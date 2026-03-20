"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [statusMessage, setStatusMessage] = useState("");

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

  async function acknowledgeAlarm(id: string) {
    const { data: userData } = await supabase.auth.getUser();

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user?.id)
      .maybeSingle();

    const dispatcherName =
      profile?.full_name || userData.user?.email || "Dispatcher";

    const { error } = await supabase
      .from("alarms")
      .update({
        acknowledged: true,
        acknowledged_by: dispatcherName,
        acknowledged_at: new Date().toISOString(),
        status: "Acknowledged",
      })
      .eq("id", id);

    if (error) {
      setStatusMessage(`Acknowledge error: ${error.message}`);
      return;
    }

    setStatusMessage(`Alarm acknowledged by ${dispatcherName}`);
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

    setStatusMessage("Alarm cleared");
  }

  useEffect(() => {
    loadAlarms();

    const channel = supabase
      .channel("dispatcher-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alarms" },
        () => {
          loadAlarms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeCritical = useMemo(() => {
    return alarms.find(
      (a) =>
        a.status === "Active" &&
        (a.priority === "Critical" || a.alarm_type === "Panic")
    );
  }, [alarms]);

  const activeAlarms = alarms.filter((a) => a.status !== "Cleared");

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-6 flex items-center justify-between rounded-3xl border border-slate-800 bg-slate-900 px-6 py-4">
          <div>
            <h1 className="text-3xl font-bold">DCS Alert Dispatcher</h1>
            <p className="mt-1 text-sm text-slate-400">
              Live emergency control screen
            </p>
          </div>

          <div className="text-right">
            <div className="text-sm text-slate-400">System status</div>
            <div className="font-semibold text-emerald-400">Online</div>
          </div>
        </div>

        <div className="mb-6 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-slate-300">
          {statusMessage || "Waiting for alarms"}
        </div>

        {activeCritical ? (
          <section className="mb-8 rounded-[2rem] border-4 border-red-300 bg-red-700 p-8 shadow-2xl">
            <div className="text-center">
              <div className="text-6xl font-black tracking-wide">
                🚨 EMERGENCY 🚨
              </div>
              <div className="mt-4 text-3xl font-bold">
                {activeCritical.alarm_type.toUpperCase()}
              </div>
              <div className="mt-3 text-xl">
                Triggered by{" "}
                <span className="font-bold">
                  {activeCritical.triggered_by_name || "Unknown user"}
                </span>
              </div>
              <div className="mt-2 text-lg">
                Role: {activeCritical.triggered_by_role || "Unknown"}
              </div>
              <div className="mt-2 text-lg">
                Location: {activeCritical.location || "Unknown"}
              </div>
              <div className="mt-2 text-lg">
                Site: {activeCritical.site_name}
              </div>
              <div className="mt-2 text-lg">
                Time: {new Date(activeCritical.created_at).toLocaleString()}
              </div>
              <div className="mt-2 text-lg">
                Message: {activeCritical.message || "-"}
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <button
                  onClick={() => acknowledgeAlarm(activeCritical.id)}
                  className="rounded-2xl bg-white px-8 py-4 text-lg font-bold text-black hover:bg-slate-100"
                >
                  Acknowledge
                </button>

                <button
                  onClick={() => clearAlarm(activeCritical.id)}
                  className="rounded-2xl bg-slate-950 px-8 py-4 text-lg font-bold text-white hover:bg-black"
                >
                  Clear
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="mb-8 rounded-[2rem] border border-slate-800 bg-slate-900 p-10 text-center">
            <div className="text-4xl font-bold text-emerald-400">
              No active emergency
            </div>
            <p className="mt-3 text-slate-400">
              Dispatcher screen is live and monitoring alarms
            </p>
          </section>
        )}

        <section className="rounded-[2rem] border border-slate-800 bg-slate-900 p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Alarm queue</h2>
            <div className="text-sm text-slate-400">
              {activeAlarms.length} active / acknowledged
            </div>
          </div>

          <div className="space-y-4">
            {alarms.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-slate-400">
                No alarms yet
              </div>
            )}

            {alarms.map((alarm) => (
              <div
                key={alarm.id}
                className={`rounded-2xl border p-5 ${
                  alarm.status === "Active" && alarm.priority === "Critical"
                    ? "border-red-500 bg-red-950/40"
                    : alarm.status === "Acknowledged"
                    ? "border-amber-500 bg-amber-950/20"
                    : alarm.status === "Cleared"
                    ? "border-slate-700 bg-slate-950/40 opacity-70"
                    : "border-slate-700 bg-slate-950/30"
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xl font-semibold">
                      {alarm.alarm_type} · {alarm.location || "Unknown location"}
                    </div>
                    <div className="mt-2 text-sm text-slate-300">
                      Triggered by:{" "}
                      <span className="font-semibold">
                        {alarm.triggered_by_name || "Unknown"}
                      </span>{" "}
                      ({alarm.triggered_by_role || "Unknown"})
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Site: {alarm.site_name}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Message: {alarm.message || "-"}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Created: {new Date(alarm.created_at).toLocaleString()}
                    </div>

                    {alarm.acknowledged && (
                      <div className="mt-2 text-sm text-emerald-400">
                        Acknowledged by {alarm.acknowledged_by || "Unknown"} at{" "}
                        {alarm.acknowledged_at
                          ? new Date(alarm.acknowledged_at).toLocaleString()
                          : "-"}
                      </div>
                    )}
                  </div>

                  <div className="flex min-w-[220px] flex-col items-start gap-3 lg:items-end">
                    <div
                      className={`rounded-full px-3 py-1 text-sm font-semibold ${
                        alarm.status === "Active"
                          ? "bg-red-200 text-red-900"
                          : alarm.status === "Acknowledged"
                          ? "bg-amber-200 text-amber-900"
                          : "bg-slate-200 text-slate-900"
                      }`}
                    >
                      {alarm.status}
                    </div>

                    <div className="flex gap-2">
                      {alarm.status === "Active" && (
                        <button
                          onClick={() => acknowledgeAlarm(alarm.id)}
                          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-slate-100"
                        >
                          Acknowledge
                        </button>
                      )}

                      {alarm.status !== "Cleared" && (
                        <button
                          onClick={() => clearAlarm(alarm.id)}
                          className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
