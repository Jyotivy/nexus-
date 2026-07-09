// src/AuthContext.js
// ─────────────────────────────────────────────────────────────
// Global auth state.  Wrap your app with <AuthProvider> and use
// useAuth() anywhere to access the current user + auth functions.
// ─────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useEffect } from "react";
import { signUp, signIn, signOut, getCurrentUser } from "./appwrite";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);   // null = not logged in
  const [loading, setLoading] = useState(true);   // checking session on mount
  const [authError, setAuthError] = useState("");

  // On first load, check if there's already a valid session
  useEffect(() => {
    getCurrentUser().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const register = async (email, password, name) => {
    setAuthError("");
    try {
      const u = await signUp(email, password, name);
      setUser(u);
      return true;
    } catch (e) {
      // Appwrite error messages are in e.message
      setAuthError(e.message || "Registration failed. Try again.");
      return false;
    }
  };

  const login = async (email, password) => {
    setAuthError("");
    try {
      const u = await signIn(email, password);
      setUser(u);
      return true;
    } catch (e) {
      setAuthError(e.message || "Invalid email or password.");
      return false;
    }
  };

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, authError, register, login, logout, setAuthError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}