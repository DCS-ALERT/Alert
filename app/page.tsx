"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type LocationResult = {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
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
  const [isStartingTracking, setIsStartingTracking] = useState(false);
  const [isStoppingTracking, setIsStoppingTracking] = useState(false);

  const trackingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const presenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const clearTrackingInterval = useCallback(() => {
    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }
  }, []);

  const clearPresenceInterval = useCallback(() => {
    if (presenceIntervalRef.current) {
      clearInterval(presenceIntervalRef.current);
      presenceIntervalRef.current = null;
    }
  }, []);

  const loadAlarms = useCallback(async () => {
    const { data, error } = await supabase
      .from("alarms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setStatusMessage(`Load error: ${error.message}`);
      return;
    }

    setAlarms((data || []) as Alarm[]);
  }, []);

  const getCurrentUserAndProfile = useCallback(async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      window.location.href = "/login";
      return null;
    }

    const { data: currentProfile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      setStatusMessage(`Profile error: ${profileError.message}`);
      return null;
    }

    return {
      user: data.user,
      profile: currentProfile as Profile | null,
    };
  }, []);

  const updatePresence = useCallback(
    async (isLoggedIn: boolean) => {
      const info = await getCurrentUserAndProfile();
      if (!info) return;

      const payload = {
        user_id: info.user.id,
        full_name: info.profile?.full_name || info.user.email,
        role: info.profile?.role || "User",
        site_name: info.profile?.site_name || "Test Site",
        is_logged_in: isLoggedIn,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("user_presence")
        .upsert([payload], { onConflict: "user_id" });

      if (error) {
        console.error("Presence update error:", error);
      }
    },
    [getCurrentUserAndProfile]
  );

  const ensureUserAndProfile = useCallback(async () => {
    const info = await getCurrentUserAndProfile();

    if (!info) return;

    setUserEmail(info.user.email || "");

    if (!info.profile) {
      setNeedsProfile(true);
      setFullNameInput(info.user.email || "");
      return;
    }

    setProfile(info.profile);
    setFullNameInput(info.profile.full_name || "");
    setRoleInput(info.profile.role || "User");
    setSiteInput(info.profile.site_name || "Test Site");
    setNeedsProfile(false);
  }, [getCurrentUserAndProfile]);

  const loadTrackingState = useCallback(async () => {
    const info = await getCurrentUserAndProfile();
    if (!info) return;

    const { data, error } = await supabase
      .from("user_locations")
      .select("user_id")
      .eq("user_id", info.user.id)
      .maybeSingle();

    if (error) return;

    setTrackingEnabled(Boolean(data));
  }, [getCurrentUserAndProfile]);

  const saveProfile = useCallback(async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      window.location.href = "/login";
      return;
    }

    const payload = {
      id: data.user.id,
      full_name: fullNameInput.trim(),
      role: roleInput.trim() || "User",
      site_name: siteInput.trim() || "Test Site",
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
    await updatePresence(true);
  }, [fullNameInput, roleInput, siteInput, updatePresence]);

  const getLocation = useCallback(async (): Promise<LocationResult> => {
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
          timeout: 10000,
          maximumAge: 5000,
        }
      );
    });
  }, []);

  const sendAlarm = useCallback(
    async (type: string) => {
      const info = await getCurrentUserAndProfile();

      if (!info?.user) {
        window.location.href = "/login";
        return;
      }

      if (!info.profile) {
        setStatusMessage("Please save your profile first.");
        setNeedsProfile(true);
        return;
      }

      setStatusMessage("Getting location...");

      const locationData = await getLocation();

      setStatusMessage(`Sending ${type} alarm...`);

      const { error } = await supabase.from("alarms").insert([
        {
          site_name: info.profile.site_name || "Test Site",
          alarm_type: type,
          location: "Reception",
          priority:
            type === "Panic" || type === "Lockdown" ? "Critical" : "High",
          status: "Active",
          message: `${type} alert triggered`,
          triggered_by_user_id: info.user.id,
          triggered_by_name: info.profile.full_name,
          triggered_by_role: info.profile.role,
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
      await loadAlarms();
    },
    [getCurrentUserAndProfile, getLocation, loadAlarms]
  );

  const updateLiveLocation = useCallback(async () => {
    const info = await getCurrentUserAndProfile();

    if (!info?.user) {
      return false;
    }

    const locationData = await getLocation();

    if (locationData.latitude === null || locationData.longitude === null) {
      setStatusMessage("Unable to get live location");
      return false;
    }

    const { error } = await supabase.from("user_locations").upsert(
      [
        {
          user_id: info.user.id,
          full_name: info.profile?.full_name || info.user.email,
          role: info.profile?.role || "User",
          site_name: info.profile?.site_name || "Test Site",
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
      return false;
    }

    await updatePresence(true);

    setStatusMessage(
      `Live tracking updated at ${new Date().toLocaleTimeString()}`
    );
    return true;
  }, [getCurrentUserAndProfile, getLocation, updatePresence]);

  const startTracking = useCallback(async () => {
    if (isStartingTracking) return;

    if (trackingEnabled && trackingIntervalRef.current) {
      setStatusMessage("Live tracking already enabled");
      return;
    }

    setIsStartingTracking(true);
    setStatusMessage("Starting live tracking...");

    clearTrackingInterval();

    const firstUpdateWorked = await updateLiveLocation();

    if (!firstUpdateWorked) {
      setTrackingEnabled(false);
      setIsStartingTracking(false);
      return;
    }

    trackingIntervalRef.current = setInterval(() => {
      updateLiveLocation();
    }, 30000);

    setTrackingEnabled(true);
    setIsStartingTracking(false);
    setStatusMessage("Live tracking enabled");
  }, [
    clearTrackingInterval,
    isStartingTracking,
    trackingEnabled,
    updateLiveLocation,
  ]);

  const stopTracking = useCallback(async () => {
    if (isStoppingTracking) return;

    setIsStoppingTracking(true);

    clearTrackingInterval();

    const { data: userData } = await supabase.auth.getUser();

    if (userData.user) {
      const { error } = await supabase
        .from("user_locations")
        .delete()
        .eq("user_id", userData.user.id);

      if (error) {
        setStatusMessage(`Stop tracking error: ${error.message}`);
        setIsStoppingTracking(false);
        return;
      }
    }

    setTrackingEnabled(false);
    setIsStoppingTracking(false);
    setStatusMessage("Live tracking stopped");
  }, [clearTrackingInterval, isStoppingTracking]);

  const signOut = useCallback(async () => {
    clearTrackingInterval();
    clearPresenceInterval();

    const { data: userData } = await supabase.auth.getUser();

    if (userData.user) {
      await supabase
        .from("user_locations")
        .delete()
        .eq("user_id", userData.user.id);

      await supabase
        .from("user_presence")
        .update({
          is_logged_in: false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userData.user.id);
    }

    await supabase.auth.signOut();
    window.location.href = "/login";
  }, [clearPresenceInterval, clearTrackingInterval]);

  useEffect(() => {
    async function init() {
      await ensureUserAndProfile();
      await loadAlarms();
      await loadTrackingState();
      await updatePresence(true);
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

    presenceIntervalRef.current = setInterval(() => {
      updatePresence(true);
    }, 60000);

    return () => {
      supabase.removeChannel(alarmsChannel);
      clearTrackingInterval();
      clearPresenceInterval();
    };
  }, [
    clearPresenceInterval,
    clearTrackingInterval,
    ensureUserAndProfile,
    loadAlarms,
    loadTrackingState,
    updatePresence,
  ]);

  useEffect(() => {
    const handleBeforeUnload = async () => {
      const { data: userData } = await supabase.auth.getUser();

      if (userData.user) {
        await supabase
          .from("user_presence")
          .update({
            is_logged_in: false,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userData.user.id);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const activeAlarms = alarms.filter((alarm) => alarm.status === "Active");

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
              disabled={trackingEnabled || isStartingTracking}
              className="rounded bg-emerald-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStartingTracking ? "Starting..." : "Start Tracking"}
            </button>

            <button
              onClick={stopTracking}
              disabled={!trackingEnabled || isStoppingTracking}
              className="rounded bg-slate-800 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStoppingTracking ? "Stopping..." : "Stop Tracking"}
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
          <h2 className="mb-4 text-lg font-semibold">Current Active Alarms</h2>

          {activeAlarms.length === 0 ? (
            <p className="text-sm text-slate-500">No active alarms</p>
          ) : (
            activeAlarms.map((alarm) => (
              <div
                key={alarm.id}
                className="mb-3 rounded-xl border p-4 last:mb-0"
              >
                <p className="font-semibold">
                  {alarm.alarm_type} – {alarm.location}
                </p>
                <p className="text-sm text-slate-500">{alarm.message}</p>
                <p className="text-sm text-slate-600">
                  Triggered by: {alarm.triggered_by_name || "Unknown"} (
                  {alarm.triggered_by_role || "Unknown"})
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(alarm.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
