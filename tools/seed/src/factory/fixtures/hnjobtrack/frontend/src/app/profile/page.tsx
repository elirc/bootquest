"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  fetchProfile,
  updateProfile,
  fetchPreferences,
  updatePreferences,
} from "@/lib/api";
import type { Profile, Preferences, NotifyFrequency } from "@/types";
import { Loader2, Save, UserCircle, Bell, Briefcase } from "lucide-react";
import { Suspense } from "react";

function ProfileContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [message, setMessage] = useState("");

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyFrequency, setNotifyFrequency] =
    useState<NotifyFrequency>("weekly");
  const [roles, setRoles] = useState("");
  const [skills, setSkills] = useState("");
  const [locations, setLocations] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [visaSponsorship, setVisaSponsorship] = useState(false);
  const [salaryMin, setSalaryMin] = useState("");
  const [excludedCompanies, setExcludedCompanies] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (searchParams.get("unsubscribe") === "true" && profile) {
      handleUnsubscribe();
    }
  }, [profile]);

  const loadData = async () => {
    try {
      const [profileData, prefsData] = await Promise.all([
        fetchProfile(),
        fetchPreferences(),
      ]);
      setProfile(profileData);
      setPrefs(prefsData);

      setDisplayName(profileData.display_name || "");
      setNotifyEnabled(profileData.notify_enabled);
      setNotifyFrequency(profileData.notify_frequency);
      setRoles(prefsData.roles.join(", "));
      setSkills(prefsData.skills.join(", "));
      setLocations(prefsData.locations.join(", "));
      setRemoteOnly(prefsData.remote_only);
      setVisaSponsorship(prefsData.visa_sponsorship);
      setSalaryMin(prefsData.salary_min?.toString() || "");
      setExcludedCompanies(prefsData.excluded_companies.join(", "));
    } catch (err) {
      console.error("Failed to load profile:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    try {
      await updateProfile({ notify_enabled: false });
      setNotifyEnabled(false);
      setMessage("You have been unsubscribed from email notifications.");
    } catch (err) {
      console.error("Failed to unsubscribe:", err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const splitTrim = (s: string) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

    try {
      await Promise.all([
        updateProfile({
          display_name: displayName || undefined,
          notify_enabled: notifyEnabled,
          notify_frequency: notifyFrequency,
        }),
        updatePreferences({
          roles: splitTrim(roles),
          skills: splitTrim(skills),
          locations: splitTrim(locations),
          remote_only: remoteOnly,
          visa_sponsorship: visaSponsorship,
          salary_min: salaryMin ? parseInt(salaryMin) : undefined,
          excluded_companies: splitTrim(excludedCompanies),
        }),
      ]);
      setMessage("Preferences saved successfully!");
    } catch (err) {
      setMessage("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Profile & Preferences
      </h1>

      {message && (
        <div
          className={`rounded-lg p-3 mb-6 text-sm ${
            message.includes("success") || message.includes("unsubscribed")
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-8">
        {/* Account */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <UserCircle size={20} className="text-gray-400" />
            Account
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={profile?.email || ""}
                disabled
                className="input bg-gray-50 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input"
                placeholder="Your name"
              />
            </div>
          </div>
        </section>

        {/* Job Preferences */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Briefcase size={20} className="text-gray-400" />
            Job Preferences
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            These power your match score and email alerts.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target Roles
              </label>
              <input
                type="text"
                value={roles}
                onChange={(e) => setRoles(e.target.value)}
                className="input"
                placeholder="e.g. Backend Engineer, Staff Engineer, SRE"
              />
              <p className="text-xs text-gray-400 mt-1">Comma-separated</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Skills
              </label>
              <input
                type="text"
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                className="input"
                placeholder="e.g. Go, PostgreSQL, Kubernetes, TypeScript"
              />
              <p className="text-xs text-gray-400 mt-1">Comma-separated</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Preferred Locations
              </label>
              <input
                type="text"
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
                className="input"
                placeholder="e.g. New York, San Francisco, Remote"
              />
              <p className="text-xs text-gray-400 mt-1">Comma-separated</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Minimum Salary (annual, USD)
              </label>
              <input
                type="number"
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                className="input"
                placeholder="e.g. 150000"
              />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remoteOnly}
                  onChange={(e) => setRemoteOnly(e.target.checked)}
                  className="text-hn focus:ring-hn rounded"
                />
                Remote only
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visaSponsorship}
                  onChange={(e) => setVisaSponsorship(e.target.checked)}
                  className="text-hn focus:ring-hn rounded"
                />
                Visa sponsorship required
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Excluded Companies
              </label>
              <input
                type="text"
                value={excludedCompanies}
                onChange={(e) => setExcludedCompanies(e.target.value)}
                className="input"
                placeholder="e.g. CompanyA, CompanyB"
              />
              <p className="text-xs text-gray-400 mt-1">
                These companies will get a 0 match score
              </p>
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Bell size={20} className="text-gray-400" />
            Email Notifications
          </h2>
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyEnabled}
                onChange={(e) => setNotifyEnabled(e.target.checked)}
                className="text-hn focus:ring-hn rounded"
              />
              Enable job match email alerts
            </label>
            {notifyEnabled && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Frequency
                </label>
                <select
                  value={notifyFrequency}
                  onChange={(e) =>
                    setNotifyFrequency(e.target.value as NotifyFrequency)
                  }
                  className="input"
                >
                  <option value="instant">Instant (when new thread parsed)</option>
                  <option value="daily">Daily digest</option>
                  <option value="weekly">Weekly digest</option>
                </select>
              </div>
            )}
          </div>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          {saving ? "Saving..." : "Save Preferences"}
        </button>
      </form>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-gray-400" />
        </div>
      }
    >
      <ProfileContent />
    </Suspense>
  );
}
