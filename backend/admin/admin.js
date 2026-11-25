// Admin panel: plain JavaScript, no build step, no dependencies.
// Security: user data is only ever inserted with textContent (never innerHTML), and the
// admin session lives in sessionStorage, so it ends when the tab is closed.
(() => {
  'use strict';

  const TOKEN_KEY = 'admin-session';
  const ROLE_LABELS = { driver: 'Chofer', passenger: 'Pasajero' };
  const KIND_LABELS = { pickup: 'Recogida (con mapa)', dropoff: 'Regreso (sin mapa)' };
  const MAX_ROUTES = 20;
  const MESSAGES = {
    INVALID_CREDENTIALS: 'Clave incorrecta.',
    TOO_MANY_ATTEMPTS: 'Demasiados intentos fallidos. Espera unos minutos y vuelve a probar.',
    EMAIL_TAKEN: 'Ya existe un usuario con ese correo.',
    USER_NOT_FOUND: 'Ese usuario ya no existe. Se actualizó la lista.',
    USER_IN_ACTIVE_TRIP: 'Forma parte de la ruta en curso. Inténtalo cuando la ruta termine.',
    COMPANY_NOT_FOUND: 'Esa empresa ya no existe. Se actualizó la lista.',
    COMPANY_NAME_TAKEN: 'Ya existe una empresa con ese nombre.',
    COMPANY_HAS_MEMBERS: 'La empresa todavía tiene usuarios. Muévelos a otra empresa o elimínalos primero.',
    COMPANY_IN_ACTIVE_TRIP: 'La empresa tiene una ruta en curso. Inténtalo cuando la ruta termine.',
    VALIDATION_FAILED: 'Revisa los datos: hay campos vacíos o inválidos.',
    NETWORK: 'No se pudo conectar con el servidor.',
  };

  const $ = (id) => document.getElementById(id);
  const state = {
    users: [],
    companies: [],
    section: 'users',
    filter: 'all',
    companyFilter: '',
    query: '',
    editing: null,
    editingCompany: null,
    /** What the confirmation dialog is about to delete: { kind: 'user' | 'company', item }. */
    deleting: null,
  };

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
    $('panel').hidden = true;
    $('logout').hidden = true;
    $('login-view').hidden = false;
    $('login-password').value = '';
    $('login-password').focus();
  }

  async function showPanel() {
    $('login-view').hidden = true;
    $('panel').hidden = false;
    $('logout').hidden = false;
    showSection(state.section);
    await load();
  }

  function showSection(section) {
    state.section = section;
    $('users-view').hidden = section !== 'users';
    $('companies-view').hidden = section !== 'companies';
    for (const tab of document.querySelectorAll('[data-section]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.section === section));
    }
  }

  function signOut() {
    token = null;
    storage.clear();
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    showLogin();
  }

  /** Users and companies always reload together: each list shows data from the other. */
  async function load() {
    try {
      const [users, companies] = await Promise.all([api('GET', '/admin/users'), api('GET', '/admin/companies')]);
      state.users = users.users;
      state.companies = companies.companies;
      render();
    } catch (error) {
      if (error.status !== 401) toast(messageFor(error), true);
    }
  }

  const companyNames = (user) => user.companies.map((company) => company.name);

  function visibleUsers() {
    const query = state.query.trim().toLowerCase();
    return state.users.filter(
      (user) =>
        (state.filter === 'all' || user.role === state.filter) &&
        (!state.companyFilter || user.companies.some((company) => company.id === state.companyFilter)) &&
        (!query ||
          [user.name, user.email, user.address, ...companyNames(user)].some((value) => value.toLowerCase().includes(query))),
    );
  }

  function cell(text, label) {
    const td = document.createElement('td');
    td.textContent = text;
    if (label) td.dataset.label = label;
    return td;
  }

  function button(text, className, label, onClick) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = text;
    if (label) element.setAttribute('aria-label', label);
    element.addEventListener('click', onClick);
    return element;
  }

  function actionsCell(name, onEdit, onDelete) {
    const actions = document.createElement('td');
    actions.className = 'actions';
    actions.append(
      button('Editar', 'ghost', `Editar ${name}`, onEdit),
      button('Eliminar', 'ghost delete', `Eliminar ${name}`, onDelete),
    );
    return actions;
  }

  function render() {
    renderCompanyFilter();
    renderUsers();
    renderCompanies();
  }

  function renderCompanyFilter() {
    const select = $('company-filter');
    if (!state.companies.some((company) => company.id === state.companyFilter)) state.companyFilter = '';
    select.replaceChildren(new Option('Todas las empresas', ''));
    for (const company of state.companies) select.add(new Option(company.name, company.id));
    select.value = state.companyFilter;
  }

  function renderUsers() {
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
      row.append(cell(user.name, 'Nombre'), cell(user.email, 'Correo'), cell(user.address || '—', 'Dirección'));

      const roleCell = document.createElement('td');
      roleCell.dataset.label = 'Rol';
      const badge = document.createElement('span');
      badge.className = `role role-${user.role}`;
      badge.textContent = ROLE_LABELS[user.role];
      roleCell.append(badge);

      const companies = cell(companyNames(user).join(', ') || 'Sin empresa', 'Empresas');
      if (user.companies.length === 0) companies.className = 'warning';
      row.append(
        roleCell,
        companies,
        cell(new Date(user.createdAt).toLocaleDateString('es'), 'Alta'),
        actionsCell(
          `a ${user.name}`,
          () => openUserDialog(user),
          () => openConfirm('user', user),
        ),
      );
      body.append(row);
    }

    const empty = $('empty');
    empty.hidden = users.length > 0;
    empty.textContent =
      state.users.length === 0
        ? 'Todavía no hay usuarios. Crea el primero con "+ Nuevo usuario".'
        : 'Ningún usuario coincide con la búsqueda.';
  }

  function renderCompanies() {
    const body = $('companies-body');
    body.replaceChildren();
    for (const company of state.companies) {
      const members = state.users.filter((user) => user.companies.some((candidate) => candidate.id === company.id));
      const drivers = members.filter((user) => user.role === 'driver').length;
      const row = document.createElement('tr');
      const routes = cell(company.routes.map((route) => route.name).join(' → ') || 'Sin rutas', 'Rutas');
      if (company.routes.length === 0) routes.className = 'warning';
      row.append(
        cell(company.name, 'Empresa'),
        routes,
        cell(`${members.length - drivers} pasajeros, ${drivers} choferes`, 'Usuarios'),
        actionsCell(
          `la empresa ${company.name}`,
          () => openCompanyDialog(company),
          () => openConfirm('company', company),
        ),
      );
      body.append(row);
    }
    $('companies-empty').hidden = state.companies.length > 0;
  }

  // ---------- create / edit user ----------

  function generatePassword() {
    // Unambiguous characters (no 0/O, 1/l/I), 14 chars from a CSPRNG.
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint32Array(14));
    return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
  }

  const selectedCompanyIds = () =>
    Array.from($('f-companies').querySelectorAll('input:checked'), (input) => input.value);

  /** A passenger picks one company (radio buttons); a driver picks one or more (checkboxes). */
  function renderCompanyChoices(selected) {
    const isDriver = $('f-role').value === 'driver';
    const chosen = isDriver ? selected : selected.slice(0, 1);
    const list = $('f-companies');
    list.replaceChildren();
    for (const company of state.companies) {
      const label = document.createElement('label');
      label.className = 'choice';
      const input = document.createElement('input');
      input.type = isDriver ? 'checkbox' : 'radio';
      input.name = 'company';
      input.value = company.id;
      input.checked = chosen.includes(company.id);
      const name = document.createElement('span');
      name.textContent = company.name;
      label.append(input, name);
      list.append(label);
    }
    $('companies-legend').textContent = isDriver ? 'Empresas' : 'Empresa';
    $('companies-hint').textContent =
      state.companies.length === 0
        ? 'Todavía no hay empresas: crea una en la sección "Empresas" antes de registrar usuarios.'
        : isDriver
          ? 'El chofer elige en la app con cuál de sus empresas trabajar.'
          : 'El pasajero solo ve las rutas de su empresa.';
  }

  function syncRole() {
    $('address-optional').hidden = $('f-role').value !== 'driver';
    renderCompanyChoices(selectedCompanyIds());
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
    $('address-optional').hidden = $('f-role').value !== 'driver';
    // A new user starts in the company being browsed, or in the only one there is.
    const preselected = state.companyFilter || (state.companies.length === 1 ? state.companies[0].id : null);
    renderCompanyChoices(user ? user.companies.map((company) => company.id) : preselected ? [preselected] : []);
    $('user-dialog').showModal();
    $('f-name').focus();
  }

  function validate(values, editing) {
    if (!values.name) return 'El nombre es obligatorio.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return 'Ingresa un correo válido.';
    if (values.companyIds.length === 0) {
      return values.role === 'driver' ? 'Elige al menos una empresa para el chofer.' : 'Elige la empresa del pasajero.';
    }
    if (values.role === 'passenger' && !values.address) return 'Los pasajeros necesitan una dirección de recogida.';
    if ((!editing || values.password) && values.password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    return null;
  }

  const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

  async function saveUser(event) {
    event.preventDefault();
    const editing = state.editing;
    const values = {
      name: $('f-name').value.trim(),
      email: $('f-email').value.trim(),
      role: $('f-role').value,
      address: $('f-address').value.trim(),
      password: $('f-password').value,
      companyIds: selectedCompanyIds(),
    };
    const problem = validate(values, Boolean(editing));
    if (problem) return showError('form-error', problem);

    const save = $('save');
    save.disabled = true;
    try {
      if (editing) {
        const changes = {};
        for (const field of ['name', 'email', 'role', 'address']) {
          if (values[field] !== editing[field]) changes[field] = values[field];
        }
        const currentIds = editing.companies.map((company) => company.id);
        if (!sameIds(values.companyIds, currentIds)) changes.companyIds = values.companyIds;
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
      await load();
    } catch (error) {
      if (error.code === 'USER_NOT_FOUND' || error.code === 'COMPANY_NOT_FOUND') {
        // The form no longer makes sense: close it and say why outside of it.
        $('user-dialog').close();
        toast(messageFor(error), true);
        await load();
      } else {
        showError('form-error', messageFor(error));
      }
    } finally {
      save.disabled = false;
    }
  }

  function showError(id, message) {
    const error = $(id);
    error.textContent = message;
    error.hidden = false;
  }

  function showCredentials(email, password) {
    $('cred-email').textContent = email;
    $('cred-password').textContent = password;
    $('credentials-dialog').showModal();
  }

  // ---------- create / edit company ----------

  /** One editable route. `id` stays on the element so the server keeps the same route when it is renamed or moved. */
  function routeRow(route) {
    const item = document.createElement('li');
    item.className = 'route-row';
    if (route?.id) item.dataset.routeId = route.id;

    const name = document.createElement('input');
    name.className = 'route-name';
    name.maxLength = 24;
    name.placeholder = 'Nombre de la ruta';
    name.autocomplete = 'off';
    name.value = route?.name ?? '';
    name.setAttribute('aria-label', 'Nombre de la ruta');

    const kind = document.createElement('select');
    kind.className = 'route-kind';
    kind.setAttribute('aria-label', 'Tipo de ruta');
    for (const [value, label] of Object.entries(KIND_LABELS)) kind.add(new Option(label, value));
    kind.value = route?.kind ?? 'pickup';

    const move = (offset) => () => {
      const sibling = offset < 0 ? item.previousElementSibling : item.nextElementSibling;
      if (!sibling) return;
      if (offset < 0) sibling.before(item);
      else sibling.after(item);
      syncRouteRows();
    };
    const controls = document.createElement('div');
    controls.className = 'route-controls';
    controls.append(
      button('↑', 'ghost route-up', 'Subir en la rotación', move(-1)),
      button('↓', 'ghost route-down', 'Bajar en la rotación', move(1)),
      button('✕', 'ghost delete', 'Quitar ruta', () => {
        item.remove();
        syncRouteRows();
      }),
    );
    item.append(name, kind, controls);
    return item;
  }

  function syncRouteRows() {
    const rows = Array.from($('c-routes').children);
    rows.forEach((row, index) => {
      row.querySelector('.route-up').disabled = index === 0;
      row.querySelector('.route-down').disabled = index === rows.length - 1;
    });
    $('add-route').hidden = rows.length >= MAX_ROUTES;
  }

  function addRoute(route) {
    const row = routeRow(route);
    $('c-routes').append(row);
    syncRouteRows();
    return row;
  }

  function openCompanyDialog(company) {
    state.editingCompany = company ?? null;
    $('company-dialog-title').textContent = company ? `Editar ${company.name}` : 'Nueva empresa';
    $('c-name').value = company?.name ?? '';
    $('c-routes').replaceChildren();
    for (const route of company?.routes ?? []) addRoute(route);
    syncRouteRows();
    $('company-error').hidden = true;
    $('company-dialog').showModal();
    $('c-name').focus();
  }

  function readRoutes() {
    return Array.from($('c-routes').children, (row) => ({
      ...(row.dataset.routeId ? { id: row.dataset.routeId } : {}),
      name: row.querySelector('.route-name').value.trim(),
      kind: row.querySelector('.route-kind').value,
    }));
  }

  function validateCompany(name, routes) {
    if (!name) return 'El nombre de la empresa es obligatorio.';
    if (routes.some((route) => !route.name)) return 'Cada ruta necesita un nombre (o quítala de la lista).';
    const names = routes.map((route) => route.name.toLowerCase());
    if (new Set(names).size !== names.length) return 'Hay dos rutas con el mismo nombre.';
    return null;
  }

  async function saveCompany(event) {
    event.preventDefault();
    const editing = state.editingCompany;
    const name = $('c-name').value.trim();
    const routes = readRoutes();
    const problem = validateCompany(name, routes);
    if (problem) return showError('company-error', problem);

    const save = $('save-company');
    save.disabled = true;
    try {
      if (editing) await api('PATCH', `/admin/companies/${editing.id}`, { name, routes });
      else await api('POST', '/admin/companies', { name, routes });
      $('company-dialog').close();
      toast(editing ? `Se guardaron los cambios de ${name}.` : `Empresa ${name} creada.`);
      await load();
    } catch (error) {
      if (error.code === 'COMPANY_NOT_FOUND') {
        $('company-dialog').close();
        toast(messageFor(error), true);
        await load();
      } else {
        showError('company-error', messageFor(error));
      }
    } finally {
      save.disabled = false;
    }
  }

  // ---------- delete ----------

  function openConfirm(kind, item) {
    state.deleting = { kind, item };
    if (kind === 'user') {
      $('confirm-title').textContent = '¿Eliminar usuario?';
      $('confirm-text').textContent = `Vas a eliminar a ${item.name} (${ROLE_LABELS[item.role].toLowerCase()}, ${item.email}).`;
      $('confirm-note').textContent = 'Se borra su cuenta y su historial de viajes. No se puede deshacer.';
    } else {
      $('confirm-title').textContent = '¿Eliminar empresa?';
      $('confirm-text').textContent = `Vas a eliminar la empresa ${item.name}.`;
      $('confirm-note').textContent =
        'Se borran sus rutas y su historial de viajes. Solo se puede eliminar si ya no tiene usuarios. No se puede deshacer.';
    }
    $('confirm-error').hidden = true;
    $('confirm-dialog').showModal();
  }

  async function confirmDelete() {
    const { kind, item } = state.deleting;
    const confirm = $('confirm-delete');
    confirm.disabled = true;
    try {
      await api('DELETE', `/admin/${kind === 'user' ? 'users' : 'companies'}/${item.id}`);
      $('confirm-dialog').close();
      toast(kind === 'user' ? `${item.name} fue eliminado.` : `La empresa ${item.name} fue eliminada.`);
      await load();
    } catch (error) {
      showError('confirm-error', messageFor(error));
    } finally {
      confirm.disabled = false;
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
      await showPanel();
    } catch (failure) {
      error.textContent = messageFor(failure);
      error.hidden = false;
    }
  });

  $('logout').addEventListener('click', signOut);
  $('new-user').addEventListener('click', () => openUserDialog(null));
  $('user-form').addEventListener('submit', saveUser);
  $('f-role').addEventListener('change', syncRole);
  $('new-company').addEventListener('click', () => openCompanyDialog(null));
  $('company-form').addEventListener('submit', saveCompany);
  $('add-route').addEventListener('click', () => addRoute(null).querySelector('.route-name').focus());
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

  for (const closer of document.querySelectorAll('[data-close]')) {
    closer.addEventListener('click', () => closer.closest('dialog').close());
  }
  // Clear the shown password from the page once the dialog closes.
  $('credentials-dialog').addEventListener('close', () => {
    $('cred-password').textContent = '';
  });

  for (const tab of document.querySelectorAll('[data-section]')) {
    tab.addEventListener('click', () => showSection(tab.dataset.section));
  }
  for (const tab of document.querySelectorAll('[data-filter]')) {
    tab.addEventListener('click', () => {
      state.filter = tab.dataset.filter;
      for (const other of document.querySelectorAll('[data-filter]')) {
        other.setAttribute('aria-selected', String(other === tab));
      }
      renderUsers();
    });
  }
  $('company-filter').addEventListener('change', (event) => {
    state.companyFilter = event.target.value;
    renderUsers();
  });
  $('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderUsers();
  });

  if (token) showPanel();
  else showLogin();
})();
