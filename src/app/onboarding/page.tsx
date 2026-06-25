import { submitOnboarding } from "./actions";

export default function OnboardingPage() {
  return (
    <form action={submitOnboarding} className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="text-xl font-semibold">Set up your clinic</h1>
      <input name="orgName" required placeholder="Clinic name" className="w-full border p-2" />
      <input name="adminName" required placeholder="Your name" className="w-full border p-2" />
      <button type="submit" className="rounded bg-black px-4 py-2 text-white">Create</button>
    </form>
  );
}
