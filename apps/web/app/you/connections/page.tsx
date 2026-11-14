import { redirect } from "next/navigation";
import { CONNECTIONS_HREF } from "@/lib/connections";

// The Connections list lives at the top of You.
export default function ConnectionsIndex() {
  redirect(CONNECTIONS_HREF);
}
