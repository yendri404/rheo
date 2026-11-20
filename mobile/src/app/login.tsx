import { Redirect } from 'expo-router';
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
        footerPosition="inline"
        header={
          <>
            <Text style={styles.title}>Rheo</Text>
            <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
          </>
        }
        footer={
          <>
            <PrimaryButton label="Iniciar sesión" onPress={submit} disabled={!canSubmit} loading={submitting} />
            {/* Private app: accounts are created by an administrator, there is no sign-up. */}
            <Text style={styles.hint}>¿No tienes cuenta? Pídela al administrador.</Text>
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
  hint: { fontFamily: fonts.regular, color: colors.disabledText, fontSize: 14, textAlign: 'center', marginTop: 16 },
});
