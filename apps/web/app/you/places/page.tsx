import { redirect } from "next/navigation";

// Places now live on the Location connection page; old links land there.
export default function PlacesPage() {
  redirect("/you/connections/travel");
}
