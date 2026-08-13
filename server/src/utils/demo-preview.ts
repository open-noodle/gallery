// Demo-only. The routes that are POSTs but semantically READS.
//
// A demo instance blocks writes by HTTP method: DemoInterceptor refuses every non-GET outside a short
// prefix list, and the admin-preview branch in AuthService additionally requires GET before it will match a
// path against DEMO_ADMIN_PREVIEW_READ_ROUTES. That is a good rule, and this list is the one exception to it
// — kept in one place so both gates agree, and deliberately kept tiny.
//
// The only entry is listing a person's face cluster. It reads, but it cannot be a GET: it takes an
// `excludeFaceIds` body (the flagged ids guided review leaves out), which is an array of up to
// MAX_RESOLVE_FACES uuids and does not belong in a query string. While it was refused, the Face Repair
// console's manual review page could not load a single face and told every visitor that the person had no
// faces in their cluster.
//
// Before adding anything here, check that the route only reads. A route on this list is reachable by a
// non-admin demo visitor with an arbitrary request body, so "it happens to be a POST" is not sufficient —
// it has to be a route where a body cannot cause a write.
const DEMO_READ_ONLY_POST_ROUTES = [/^\/api\/admin\/face-repair\/scan\/person\/[^/]+\/cluster-faces$/];

// Anchored, never prefix-matched: a prefix match would open every path *below* these routes too. AuthService
// receives the route uri without the `/api` mount prefix on some call paths, so normalise before testing.
export const isDemoReadOnlyPostRoute = (uri: string): boolean => {
  const path = uri.startsWith('/api/') ? uri : `/api${uri}`;
  return DEMO_READ_ONLY_POST_ROUTES.some((route) => route.test(path));
};
