type SignupUser = {
  emailVerified: boolean;
  displayName: string | null;
};

type SignupOperations<User extends SignupUser> = {
  create: (email: string, password: string) => Promise<User>;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  sendVerification: (user: User) => Promise<void>;
  updateName: (user: User, name: string) => Promise<void>;
};

export function authErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

export function customerAuthMessage(error: unknown): string {
  switch (authErrorCode(error)) {
    case "auth/email-already-in-use":
      return "This email has an account. Sign in with its password to continue or resend verification.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Choose a stronger password.";
    case "auth/network-request-failed":
      return "Could not connect to Firebase. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait before trying again.";
    case "auth/operation-not-allowed":
      return "Email/password signup is unavailable. Please contact support.";
    case "auth/invalid-api-key":
    case "auth/app-not-authorized":
    case "auth/unauthorized-domain":
      return "The sign-in service is not configured for this app. Please contact support.";
    default:
      return error instanceof Error ? error.message : "Something went wrong. Please try again.";
  }
}

// Creation, verification delivery and profile updates are separate Firebase
// requests. A failed later request must not strand an unverified account.
export async function startCustomerSignup<User extends SignupUser>(
  operations: SignupOperations<User>,
  input: { email: string; password: string; name: string },
) {
  const email = input.email.trim();
  let user: User;
  let recovered = false;
  try {
    user = await operations.create(email, input.password);
  } catch (error) {
    if (authErrorCode(error) !== "auth/email-already-in-use") throw error;
    // Prove ownership with the supplied password before resuming anything.
    try {
      user = await operations.signIn(email, input.password);
    } catch (signInError) {
      if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(authErrorCode(signInError))) {
        throw error;
      }
      throw signInError;
    }
    if (user.emailVerified) {
      await operations.signOut();
      throw error;
    }
    recovered = true;
  }

  let verificationError: unknown = null;
  try {
    await operations.sendVerification(user);
  } catch (error) {
    verificationError = error;
  }
  // Profile saving must not prevent delivery of the verification email, and a
  // recovered account keeps its existing name.
  let profileError: unknown = null;
  if (!user.displayName && input.name.trim()) {
    try {
      await operations.updateName(user, input.name.trim());
    } catch (error) {
      profileError = error;
    }
  }
  return { user, recovered, verificationError, profileError };
}
