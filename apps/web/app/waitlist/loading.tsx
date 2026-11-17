/** The waiting list for admins, loading: its own blank frame (never Today's skeleton). No title,
 * so a visitor who is not an admin never sees what the page would be. */
export default function Loading() {
  return <main className="screen" aria-busy="true" aria-label="Loading" />;
}
