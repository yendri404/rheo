import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text } from 'react-native';
import { errorMessage } from '../api/client';
import { useSession } from '../session/session-context';
import { PrimaryButton } from '../ui/primary-button';
import { ScreenLayout } from '../ui/screen-layout';
import { TextField } from '../ui/text-field';
import { colors, fonts } from '../ui/theme';

export default function LoginScreen() {
  const { session, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Redirect href="/" />;

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenLayout
        header={
          <>
            <Text style={styles.title}>Proyecto Carreras</Text>
            <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
          </>
        }
        footer={
          <>
            <PrimaryButton label="Iniciar sesión" onPress={submit} disabled={!canSubmit} loading={submitting} />
            <Link href="/register" replace style={styles.link}>
              ¿No tienes cuenta? <Text style={styles.linkStrong}>Crear cuenta</Text>
            </Link>
          </>
        }
      >
        <TextField
          label="Correo electrónico"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
        />
        <TextField
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error && (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </ScreenLayout>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.regular, fontSize: 34, color: colors.dark, marginTop: 48 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, color: colors.background, marginTop: 6 },
  error: { fontFamily: fonts.regular, color: colors.danger, fontSize: 14, marginTop: 4 },
  link: { fontFamily: fonts.regular, color: colors.dark, fontSize: 14, textAlign: 'center', marginTop: 16 },
  linkStrong: { fontFamily: fonts.bold, color: colors.primary },
});
