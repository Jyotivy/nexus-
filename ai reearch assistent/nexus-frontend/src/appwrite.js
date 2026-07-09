// src/appwrite.js
// ─────────────────────────────────────────────────────────────
// Appwrite configuration and helper functions.
//
// HOW TO SET UP (one time):
//  1. Go to https://cloud.appwrite.io  →  Create a project
//  2. Project ID → copy and paste below as APPWRITE_PROJECT_ID
//  3. In your project → Auth → Settings → enable "Email/Password"
//  4. That's it! No database needed for Phase 2 (auth only).
//     Search history storage comes in Phase 3 (Appwrite Databases).
//
// Replace the values below with your actual Appwrite project details.
// ─────────────────────────────────────────────────────────────

import { Client, Account, ID } from "appwrite";

// ── CONFIG ────────────────────────────────────────────────────
// Replace with your real values from https://cloud.appwrite.io
const APPWRITE_ENDPOINT = "https://cloud.appwrite.io/v1";  // keep as-is for cloud
const APPWRITE_PROJECT_ID = "6a4aabfb000b653d4c86";              // <── paste your Project ID here

// ── CLIENT SETUP ─────────────────────────────────────────────
const client = new Client();
client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);

// ── AUTH HELPERS ──────────────────────────────────────────────

/**
 * Creates an email/password session, safely handling the case where a
 * session is already active (Appwrite throws "Creation of a session is
 * prohibited when a session is active" in that case). We simply clear the
 * stale session and try again so the user never sees that raw error.
 */
async function createSessionSafely(email, password) {
  try {
    await account.createEmailPasswordSession(email, password);
  } catch (e) {
    const msg = (e?.message || "").toLowerCase();
    if (msg.includes("session is active") || msg.includes("session_already_exists")) {
      try {
        await account.deleteSession("current");
      } catch {
        // no active session to delete, ignore
      }
      await account.createEmailPasswordSession(email, password);
    } else {
      throw e;
    }
  }
}

/**
 * Create a new user account.
 * @param {string} email
 * @param {string} password
 * @param {string} name  - display name
 */
export async function signUp(email, password, name) {
  // Creates the account
  await account.create(ID.unique(), email, password, name);
  // Immediately log them in so they get a session
  await createSessionSafely(email, password);
  // Return the user object
  return account.get();
}

/**
 * Log in an existing user.
 * @param {string} email
 * @param {string} password
 */
export async function signIn(email, password) {
  await createSessionSafely(email, password);
  return account.get();
}

/**
 * Log out the current session.
 */
export async function signOut() {
  await account.deleteSession("current");
}

/**
 * Get the currently logged-in user, or null if not logged in.
 */
export async function getCurrentUser() {
  try {
    return await account.get();
  } catch {
    return null;
  }
}