import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { auth } from "./client";

const googleProvider = new GoogleAuthProvider();

type EmailPasswordParams = {
  email: string;
  password: string;
  displayName?: string;
};

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signInWithEmail({ email, password }: EmailPasswordParams) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail({ email, password, displayName }: EmailPasswordParams) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(result.user, { displayName });
  }
  return result;
}

export async function logout() {
  return signOut(auth);
}
