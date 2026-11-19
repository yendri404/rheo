import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { errorMessage } from '../api/client';
import { useSession } from '../session/session-context';
import { PrimaryButton } from '../ui/primary-button';
import { ScreenLayout } from '../ui/screen-layout';
import { TextField } from '../ui/text-field';
import { colors, fonts } from '../ui/theme';

const MIN_PASSWORD = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Self sign-up always creates a passenger; drivers are assigned by an administrator. */
export default function RegisterScreen() {
  const { session, signUp } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Redirect href="/" />;

  const problems = [
    !name.trim() && 'nombre',
    !EMAIL_PATTERN.test(email.trim()) && 'correo válido',
    !address.trim() && 'dirección',
    password.length < MIN_PASSWORD && `contraseña de al menos ${MIN_PASSWORD} caracteres`,
  ].filter(Boolean);
  const canSubmit = problems.length === 0;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await signUp({ name: name.trim(), email: email.trim(), address: address.trim(), password });
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenLayout
        headerHeight="20%"
        header={<Text style={styles.title}>Crear cuenta</Text>}
        footer={
          <>
            <PrimaryButton label="Registrarme" onPress={submit} disabled={!canSubmit} loading={submitting} />
            <Link href="/login" replace style={styles.link}>
              ¿Ya tienes cuenta? <Text style={styles.linkStrong}>Iniciar sesión</Text>
            </Link>
          </>
        }
      >
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextField label="Nombre" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
          <TextField
            label="Correo electrónico"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <TextField
            label="Dirección de recogida"
            value={address}
            onChangeText={setAddress}
            autoComplete="street-address"
            textContentType="fullStreetAddress"
            placeholder="Calle, número, referencia"
          />
          <TextField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder={`Mínimo ${MIN_PASSWORD} caracteres`}
            onSubmitEditing={submit}
          />
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : (
            !canSubmit &&
            Boolean(name || email || address || password) && (
              <Text style={styles.hint}>Falta: {problems.join(', ')}.</Text>
            )
          )}
        </ScrollView>
      </ScreenLayout>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.regular, fontSize: 30, color: colors.background },
  error: { fontFamily: fonts.regular, color: colors.danger, fontSize: 14, marginTop: 4 },
  hint: { fontFamily: fonts.regular, color: colors.disabledText, fontSize: 13, marginTop: 4 },
  link: { fontFamily: fonts.regular, color: colors.dark, fontSize: 14, textAlign: 'center', marginTop: 16 },
  linkStrong: { fontFamily: fonts.bold, color: colors.primary },
});
