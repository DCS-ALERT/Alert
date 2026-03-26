"use client";

import { useEffect, useRef, useState } from "react";
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

type Profile = {
  id: string;
  full_name: string | null;
  role: string | null;
  site_name: string | null;
};

export default function HomePage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullNameInput, setFullNameInput] = useState("");
  const [roleInput, setRoleInput] = useState("User");
  const [siteInput, setSiteInput] = useState("Test Site");
  const [needsProfile, setNeedsProfile] = useState(false);
  const [trackingEnabled, setTrackingEnabled] = useState(false);

  const trackingIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

  async function ensureUserAndProfile() {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      window.location.href = "/login";
      return;
    }

    setUserEmail(data.user.email || "");

    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      setStatusMessage(`Profile error: ${profileError.message}`);
      return;
    }

    if (!existingProfile) {
      setNeedsProfile(true);
      setFullNameInput(data.user.email || "");
      return;
    }

    setProfile(existingProfile);
    setNeedsProfile(false);
  }

  async function saveProfile() {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      window.location.href = "/login";
      return;
    }

    const payload = {
      id: data.user.id,
      full_name: fullNameInput,
      role: roleInput,
      site_name: siteInput,
    };

    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert([payload]);

    if (upsertError) {
      setStatusMessage(`Save profile error: ${upsertError.message}`);
      return;
    }

    setProfile(payload);
    setNeedsProfile(false);
    setStatusMessage("Profile saved");
  }

  async function getLocation(): Promise<{
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
  }> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ latitude: null, longitude: null, accuracy: null });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        },
        () => {
          resolve({ latitude: null, longitude: null, accuracy: null });
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
        }
      );
    });
  }

  async function sendAlarm(type: string) {
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      window.location.href = "/login";
      return;
    }

    const { data: currentProfile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileError || !currentProfile) {
      setStatusMessage("Please save your profile first.");
      setNeedsProfile(true);
      return;
    }

    setStatusMessage("Getting location...");

    const locationData = await getLocation();

    setStatusMessage(`Sending ${type} alarm...`);

    const { error } = await supabase.from("alarms").insert([
      {
        site_name: currentProfile.site_name || "Test Site",
        alarm_type: type,
        location: "Reception",
        priority: type === "Panic" || type === "Lockdown" ? "Critical" : "High",
        status: "Active",
        message: `${type} alert triggered`,
        triggered_by_user_id: userData.user.id,
        triggered_by_name: currentProfile.full_name,
        triggered_by_role: currentProfile.role,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        location_accuracy: locationData.accuracy,
      },
    ]);

    if (error) {
      setStatusMessage(`Insert error: ${error.message}`);
      return;
    }

    setStatusMessage(`${type} alarm sent`);
  }

  async function updateLiveLocation() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user.id)
      .maybeSingle();

    const locationData = await getLocation();

    if (locationData.latitude === null || locationData.longitude === null) {
      setStatusMessage("Unable to get live location");
      return;
    }

    const { error } = await supabase.from("user_locations").upsert(
      [
        {
          user_id: userData.user.id,
          full_name: currentProfile?.full_name || userData.user.email,
          role: currentProfile?.role || "User",
          site_name: currentProfile?.site_name || "Test Site",
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          accuracy: locationData.accuracy,
          updated_at: new Date().toISOString(),
        },
      ],
      {
        onConflict: "user_id",
      }
    );

    if (error) {
      setStatusMessage(`Tracking error: ${error.message}`);
      return;
    }

    setStatusMessage(
      `Live tracking updated at ${new Date().toLocaleTimeString()}`
    );
  }

  async function startTracking() {
    if (trackingEnabled) {
      setStatusMessage("Live tracking already enabled");
      return;
    }

    setStatusMessage("Starting live tracking...");

    await updateLiveLocation();

    trackingIntervalRef.current = setInterval(() => {
      updateLiveLocation();
    }, 30000);

    setTrackingEnabled(true);
    setStatusMessage("Live tracking enabled");
  }

  async function stopTracking() {
    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }

    const { data: userData } = await supabase.auth.getUser();

    if (userData.user) {
      await supabase
        .from("user_locations")
        .delete()
        .eq("user_id", userData.user.id);
    }

    setTrackingEnabled(false);
    setStatusMessage("Live tracking stopped");
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

  async function signOut() {
    await stopTracking();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  useEffect(() => {
    async function init() {
      await ensureUserAndProfile();
      await loadAlarms();
    }

    init();

    const alarmsChannel = supabase
      .channel("alarms-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alarms" },
        () => {
          loadAlarms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(alarmsChannel);

      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">DCS Alert Dashboard</h1>
              <p className="text-sm text-slate-600">
                Logged in as: {profile?.full_name || userEmail || "Unknown user"}
              </p>
              <p className="text-sm text-slate-500">
                Role: {profile?.role || "-"} · Site: {profile?.site_name || "-"}
              </p>
            </div>

            <button
              onClick={signOut}
              className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
            >
              Sign out
            </button>
          </div>

          <div className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
            {statusMessage || "System ready"}
          </div>
        </div>

        {needsProfile && (
          <div className="rounded-3xl bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold">Complete your profile</h2>

            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="text"
                placeholder="Full name"
                className="rounded border p-3"
                value={fullNameInput}
                onChange={(e) => setFullNameInput(e.target.value)}
              />

              <input
                type="text"
                placeholder="Role"
                className="rounded border p-3"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value)}
              />

              <input
                type="text"
                placeholder="Site name"
                className="rounded border p-3"
                value={siteInput}
                onChange={(e) => setSiteInput(e.target.value)}
              />
            </div>

            <button
              onClick={saveProfile}
              className="mt-4 rounded bg-slate-900 px-4 py-2 text-white"
            >
              Save profile
            </button>
          </div>
        )}

        <div className="rounded-3xl bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold">Live Tracking</h2>

          <div className="flex gap-3">
            <button
              onClick={startTracking}
              className="rounded bg-emerald-600 px-4 py-2 text-white"
            >
              Start Tracking
            </button>

            <button
              onClick={stopTracking}
              className="rounded bg-slate-800 px-4 py-2 text-white"
            >
              Stop Tracking
            </button>
          </div>

          <p className="mt-3 text-sm text-slate-500">
            Sends your live GPS location every 30 seconds while enabled.
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Tracking status:{" "}
            <span className="font-semibold">
              {trackingEnabled ? "Enabled" : "Disabled"}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <button
            onClick={() => sendAlarm("Panic")}
            className="rounded-3xl bg-red-600 p-6 text-lg font-semibold text-white hover:bg-red-700"
          >
            🚨 Panic
          </button>

          <button
            onClick={() => sendAlarm("Lockdown")}
            className="rounded-3xl bg-purple-600 p-6 text-lg font-semibold text-white hover:bg-purple-700"
          >
            🔒 Lockdown
          </button>

          <button
            onClick={() => sendAlarm("Medical")}
            className="rounded-3xl bg-blue-600 p-6 text-lg font-semibold text-white hover:bg-blue-700"
          >
            🏥 Medical
          </button>

          <button
            onClick={() => sendAlarm("Fire")}
            className="rounded-3xl bg-orange-600 p-6 text-lg font-semibold text-white hover:bg-orange-700"
          >
            🔥 Fire
          </button>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold">Active Alarms</h2>

          {alarms.length === 0 && (
            <p className="text-sm text-slate-500">No alarms yet</p>
          )}

          {alarms.map((alarm) => (
            <div
              key={alarm.id}
              className="mb-3 flex items-center justify-between rounded-xl border p-4"
            >
              <div>
                <p className="font-semibold">
                  {alarm.alarm_type} – {alarm.location}
                </p>
                <p className="text-sm text-slate-500">{alarm.message}</p>
                <p className="text-sm text-slate-600">
                  Triggered by: {alarm.triggered_by_name || "Unknown"} ({alarm.triggered_by_role || "Unknown"})
                </p>

                {alarm.latitude !== null && alarm.longitude !== null && (
                  <p className="text-sm text-slate-400">
                    GPS: {alarm.latitude.toFixed(5)}, {alarm.longitude.toFixed(5)}
                  </p>
                )}

                <p className="text-xs text-slate-400">
                  {new Date(alarm.created_at).toLocaleString()}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs">{alarm.status}</span>

                {alarm.status !== "Cleared" && (
                  <button
                    onClick={() => clearAlarm(alarm.id)}
                    className="rounded bg-slate-900 px-3 py-1 text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
