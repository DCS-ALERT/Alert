"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type AuditLog = {
  id: string;
  action_type: string;
  target_type: string;
  target_id: string | null;
  target_name: string | null;
  performed_by_user_id: string | null;
  performed_by_name: string | null;
  site_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export default function DispatcherHistoryPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [statusMessage, setStatusMessage] = useState("Loading...");
  const [alarmFilter, setAlarmFilter] = useState("all");

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

  const loadAuditLogs = useCallback(async () => {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      setStatusMessage(`Load audit log error: ${error.message}`);
      return;
    }

    setAuditLogs((data || []) as AuditLog[]);
  }, []);

  useEffect(() => {
    async function init() {
      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
        setStatusMessage("Not authenticated - please log in");
        return;
      }

      await loadAlarms();
      await loadAuditLogs();
      setStatusMessage("History loaded");
    }

    init();

    const alarmsChannel = supabase
      .channel("dispatcher-history-alarms")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alarms" },
        async () => {
          await loadAlarms();
        }
      )
      .subscribe();

    const auditChannel = supabase
      .channel("dispatcher-history-audit")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "audit_log" },
        async () => {
          await loadAuditLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(alarmsChannel);
      supabase.removeChannel(auditChannel);
    };
  }, [loadAlarms, loadAuditLogs]);

  const filteredAlarms = useMemo(() => {
    if (alarmFilter === "all") return alarms;
    return alarms.filter(
      (a) => a.alarm_type.toLowerCase() === alarmFilter.toLowerCase()
    );
  }, [alarmFilter, alarms]);

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dispatcher Alarm History</h1>
            <p className="mt-1 text-sm text-slate-400">
              Alarm records and dispatcher audit log
            </p>
          </div>

          <div className="flex gap-3">
            <a
              href="/dispatcher"
              className="rounded bg-slate-700 px-4 py-2 font-semibold text-white"
            >
              Back to Dispatcher
            </a>

            <button
              onClick={() => {
                loadAlarms();
                loadAuditLogs();
                setStatusMessage("History refreshed");
              }}
              className="rounded bg-slate-700 px-4 py-2 font-semibold text-white"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="rounded bg-slate-800 p-3 text-sm">{statusMessage}</div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Alarm History</h2>

            <select
              value={alarmFilter}
              onChange={(e) => setAlarmFilter(e.target.value)}
              className="rounded bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="all">All alarms</option>
              <option value="panic">Panic</option>
              <option value="lockdown">Lockdown</option>
              <option value="medical">Medical</option>
              <option value="fire">Fire</option>
            </select>
          </div>

          {filteredAlarms.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              No alarms found
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlarms.map((alarm) => (
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
                      {alarm.latitude !== null && alarm.longitude !== null && (
                        <div className="mt-1 text-xs text-slate-500">
                          GPS: {alarm.latitude.toFixed(5)},{" "}
                          {alarm.longitude.toFixed(5)}
                        </div>
                      )}
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

        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Audit Log</h2>
            <div className="text-sm text-slate-400">
              Last {auditLogs.length} actions
            </div>
          </div>

          {auditLogs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              No audit actions yet
            </div>
          ) : (
            <div className="space-y-3">
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-semibold">
                        {log.action_type.replaceAll("_", " ")}
                      </div>
                      <div className="mt-1 text-sm text-slate-300">
                        Target: {log.target_type}
                        {log.target_name ? ` · ${log.target_name}` : ""}
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        Performed by: {log.performed_by_name || "Unknown"}
                      </div>
                      {log.site_name && (
                        <div className="mt-1 text-sm text-slate-400">
                          Site: {log.site_name}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(log.created_at).toLocaleString()}
                      </div>
                    </div>

                    <div className="max-w-md text-xs text-slate-400">
                      <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/30 p-3">
                        {JSON.stringify(log.details || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
