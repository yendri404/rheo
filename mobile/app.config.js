// Dynamic layer over app.json. Only the internal test build differs from the regular one.
//
// EXPO_PUBLIC_DEBUG_API=true (the "preview-debug" EAS profile) adds an in-app setting to point the
// app at any API, typically http://<LAN IP>:3000 on a developer machine. Android blocks plain
// HTTP in release builds, so that build, and only that build, allows cleartext traffic.
const DEBUG_API = process.env.EXPO_PUBLIC_DEBUG_API === 'true';

module.exports = ({ config }) => {
  if (!DEBUG_API) return config;
  return {
    ...config,
    plugins: config.plugins.map((plugin) =>
      plugin === 'expo-build-properties' ? ['expo-build-properties', { android: { usesCleartextTraffic: true } }] : plugin,
    ),
  };
};
