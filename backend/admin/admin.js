// Admin panel: plain JavaScript, no build step, no dependencies.
// Security: user data is only ever inserted with textContent (never innerHTML), and the
// admin session lives in sessionStorage, so it ends when the tab is closed.
(() => {
  'use strict';

  const TOKEN_KEY = 'admin-session';
  const ROLE_LABELS = { driver: 'Chofer', passenger: 'Pasajero' };
  const MESSAGES = {
    INVALID_CREDENTIALS: 'Clave incorrecta.',
    TOO_MANY_ATTEMPTS: 'Demasiados intentos fallidos. Espera unos minutos y vuelve a probar.',
    EMAIL_TAKEN: 'Ya existe un usuario con ese correo.',
    USER_NOT_FOUND: 'Ese usuario ya no existe. Se actualizó la lista.',
    USER_IN_ACTIVE_TRIP: 'Forma parte de la ruta en curso. Inténtalo cuando la ruta termine.',
    VALIDATION_FAILED: 'Revisa los datos: hay campos vacíos o inválidos.',
    NETWORK: 'No se pudo conectar con el servidor.',
  };

  const $ = (id) => document.getElementById(id);
  const state = { users: [], filter: 'all', query: '', editing: null, deleting: null };

  // ---------- session + API ----------

  const storage = {
    get: () => {
      try {
        return sessionStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    },
    set: (token) => {
      try {
        sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* private mode: session lasts until reload */
      }
    },
    clear: () => {
      try {
        sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
    },
  };
  let token = storage.get();

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  async function api(method, path, body) {
    let response;
    try {
      response = await fetch(path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Network error');
    }
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new ApiError(response.status, payload?.error?.code ?? 'UNKNOWN', payload?.error?.message ?? '');
      // Expired or invalid admin session: back to the login screen.
      if (response.status === 401 && path !== '/admin/login') signOut();
      throw error;
    }
    return payload;
  }

  const messageFor = (error) => MESSAGES[error.code] ?? 'Ocurrió un error inesperado.';

  // ---------- views ----------

  function showLogin() {
    $('users-view').hidden = true;
    $('logout').hidden = true;
    $('login-view').hidden = false;
    $('login-password').value = '';
    $('login-password').focus();
  }

  async function showUsers() {
    $('login-view').hidden = true;
    $('users-view').hidden = false;
    $('logout').hidden = false;
    await loadUsers();
  }

  function signOut() {
    token = null;
    storage.clear();
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    showLogin();
  }

  async function loadUsers() {
    try {
      state.users = (await api('GET', '/admin/users')).users;
      render();
    } catch (error) {
      if (error.status !== 401) toast(messageFor(error), true);
    }
  }

  function visibleUsers() {
    const query = state.query.trim().toLowerCase();
    return state.users.filter(
      (user) =>
        (state.filter === 'all' || user.role === state.filter) &&
        (!query || [user.name, user.email, user.address].some((value) => value.toLowerCase().includes(query))),
    );
  }

  function cell(text, label) {
    const td = document.createElement('td');
    td.textContent = text;
    if (label) td.dataset.label = label;
    return td;
  }

  function render() {
    for (const role of ['all', 'driver', 'passenger']) {
      const count = role === 'all' ? state.users.length : state.users.filter((user) => user.role === role).length;
      document.querySelector(`[data-count="${role}"]`).textContent = `(${count})`;
    }

    const body = $('users-body');
    body.replaceChildren();
    const users = visibleUsers();
    for (const user of users) {
      const row = document.createElement('tr');
      row.dataset.userId = user.id;
      row.append(
        cell(user.name, 'Nombre'),
        cell(user.email, 'Correo'),
        cell(user.address || '—', 'Dirección'),
      );

      const roleCell = document.createElement('td');
      roleCell.dataset.label = 'Rol';
      const badge = document.createElement('span');
      badge.className = `role role-${user.role}`;
      badge.textContent = ROLE_LABELS[user.role];
      roleCell.append(badge);
      row.append(roleCell, cell(new Date(user.createdAt).toLocaleDateString('es'), 'Alta'));

      const actions = document.createElement('td');
      actions.className = 'actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ghost';
      edit.textContent = 'Editar';
      edit.setAttribute('aria-label', `Editar a ${user.name}`);
      edit.addEventListener('click', () => openUserDialog(user));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost delete';
      remove.textContent = 'Eliminar';
      remove.setAttribute('aria-label', `Eliminar a ${user.name}`);
      remove.addEventListener('click', () => openConfirm(user));
      actions.append(edit, remove);
      row.append(actions);
      body.append(row);
    }

    const empty = $('empty');
    empty.hidden = users.length > 0;
    empty.textContent = state.users.length === 0 ? 'Todavía no hay usuarios. Crea el primero con "+ Nuevo usuario".' : 'Ningún usuario coincide con la búsqueda.';
  }

  // ---------- create / edit ----------

  function generatePassword() {
    // Unambiguous characters (no 0/O, 1/l/I), 14 chars from a CSPRNG.
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint32Array(14));
    return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
  }

  function syncRoleHints() {
    const isDriver = $('f-role').value === 'driver';
    $('address-optional').hidden = !isDriver;
  }

  function openUserDialog(user) {
    state.editing = user ?? null;
    const editing = Boolean(user);
    $('user-dialog-title').textContent = editing ? `Editar a ${user.name}` : 'Nuevo usuario';
    $('f-name').value = user?.name ?? '';
    $('f-email').value = user?.email ?? '';
    $('f-role').value = user?.role ?? 'passenger';
    $('f-address').value = user?.address ?? '';
    $('f-password').value = '';
    $('f-password').type = 'password';
    $('toggle-password').textContent = 'Mostrar';
    $('password-label').textContent = editing ? 'Nueva contraseña' : 'Contraseña';
    $('password-hint').textContent = editing
      ? 'Déjala vacía para no cambiarla. Mínimo 8 caracteres.'
      : 'Mínimo 8 caracteres. Usa "Generar" para crear una segura.';
    $('form-error').hidden = true;
    syncRoleHints();
    $('user-dialog').showModal();
    $('f-name').focus();
  }

  function validate(values, editing) {
    if (!values.name) return 'El nombre es obligatorio.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return 'Ingresa un correo válido.';
    if (values.role === 'passenger' && !values.address) return 'Los pasajeros necesitan una dirección de recogida.';
    if ((!editing || values.password) && values.password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    return null;
  }

  async function saveUser(event) {
    event.preventDefault();
    const editing = state.editing;
    const values = {
      name: $('f-name').value.trim(),
      email: $('f-email').value.trim(),
      role: $('f-role').value,
      address: $('f-address').value.trim(),
      password: $('f-password').value,
    };
    const problem = validate(values, Boolean(editing));
    if (problem) return showFormError(problem);

    const save = $('save');
    save.disabled = true;
    try {
      if (editing) {
        const changes = {};
        for (const field of ['name', 'email', 'role', 'address']) {
          if (values[field] !== editing[field]) changes[field] = values[field];
        }
        if (values.password) changes.password = values.password;
        if (Object.keys(changes).length === 0) {
          $('user-dialog').close();
          return;
        }
        await api('PATCH', `/admin/users/${editing.id}`, changes);
        $('user-dialog').close();
        toast(`Se guardaron los cambios de ${values.name}.`);
        if (values.password) showCredentials(values.email, values.password);
      } else {
        await api('POST', '/admin/users', values);
        $('user-dialog').close();
        toast(`${ROLE_LABELS[values.role]} ${values.name} creado.`);
        showCredentials(values.email, values.password);
      }
      await loadUsers();
    } catch (error) {
      if (error.code === 'USER_NOT_FOUND') {
        // The form no longer makes sense: close it and say why outside of it.
        $('user-dialog').close();
        toast(messageFor(error), true);
        await loadUsers();
      } else {
        showFormError(messageFor(error));
      }
    } finally {
      save.disabled = false;
    }
  }

  function showFormError(message) {
    const error = $('form-error');
    error.textContent = message;
    error.hidden = false;
  }

  function showCredentials(email, password) {
    $('cred-email').textContent = email;
    $('cred-password').textContent = password;
    $('credentials-dialog').showModal();
  }

  // ---------- delete ----------

  function openConfirm(user) {
    state.deleting = user;
    $('confirm-text').textContent = `Vas a eliminar a ${user.name} (${ROLE_LABELS[user.role].toLowerCase()}, ${user.email}).`;
    $('confirm-error').hidden = true;
    $('confirm-dialog').showModal();
  }

  async function confirmDelete() {
    const user = state.deleting;
    const button = $('confirm-delete');
    button.disabled = true;
    try {
      await api('DELETE', `/admin/users/${user.id}`);
      $('confirm-dialog').close();
      toast(`${user.name} fue eliminado.`);
      await loadUsers();
    } catch (error) {
      const message = $('confirm-error');
      message.textContent = messageFor(error);
      message.hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  // ---------- toast ----------

  let toastTimer;
  function toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('error-toast', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3500);
  }

  // ---------- wiring ----------

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('login-error');
    error.hidden = true;
    try {
      token = (await api('POST', '/admin/login', { password: $('login-password').value })).token;
      storage.set(token);
      await showUsers();
    } catch (failure) {
      error.textContent = messageFor(failure);
      error.hidden = false;
    }
  });

  $('logout').addEventListener('click', signOut);
  $('new-user').addEventListener('click', () => openUserDialog(null));
  $('user-form').addEventListener('submit', saveUser);
  $('f-role').addEventListener('change', syncRoleHints);
  $('confirm-delete').addEventListener('click', confirmDelete);

  $('toggle-password').addEventListener('click', () => {
    const input = $('f-password');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('toggle-password').textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
  });
  $('generate-password').addEventListener('click', () => {
    $('f-password').value = generatePassword();
    $('f-password').type = 'text';
    $('toggle-password').textContent = 'Ocultar';
  });
  $('copy-credentials').addEventListener('click', async () => {
    const text = `Correo: ${$('cred-email').textContent}\nContraseña: ${$('cred-password').textContent}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Credenciales copiadas.');
    } catch {
      toast('No se pudo copiar. Cópialas manualmente.', true);
    }
  });

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }
  // Clear the shown password from the page once the dialog closes.
  $('credentials-dialog').addEventListener('close', () => {
    $('cred-password').textContent = '';
  });

  for (const tab of document.querySelectorAll('[data-filter]')) {
    tab.addEventListener('click', () => {
      state.filter = tab.dataset.filter;
      for (const other of document.querySelectorAll('[data-filter]')) {
        other.setAttribute('aria-selected', String(other === tab));
      }
      render();
    });
  }
  $('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    render();
  });

  if (token) showUsers();
  else showLogin();
})();
