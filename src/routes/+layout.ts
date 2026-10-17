// Entries live in the browser's localStorage and the calendar depends on the
// visitor's current date, so there is nothing meaningful to render on the
// server. Prerender an app shell and render everything on the client.
export const prerender = true;
export const ssr = false;
