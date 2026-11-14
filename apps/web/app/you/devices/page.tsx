import { redirect } from "next/navigation";
import { CONNECTIONS_HREF } from "@/lib/connections";

// Old name. Devices are Connections now (You, Connections); old links and docs still land there.
export default function DevicesRedirect() {
  redirect(CONNECTIONS_HREF);
}
