// src/app/page.tsx — "/" → dashboard (the proxy sends signed-out users to /login).
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
