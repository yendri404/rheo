import { Redirect } from 'expo-router';

/** Unknown paths (e.g. an old /register link) go back to the start instead of an error page. */
export default function NotFound() {
  return <Redirect href="/" />;
}
