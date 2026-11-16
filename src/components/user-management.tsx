"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { Locale, Profile } from "@/lib/domain";
import { roleLabels } from "@/lib/domain";
import {
  canManageUsers,
  managedRoles,
  userPageSchema,
  type ManagedUser,
  type UserCommand,
  type UserPage,
} from "@/lib/user-management";
import { Avatar, Empty, Modal, t } from "./ui";
import { ProtectedForm, useLeaveConfirmation } from "./unsaved-changes";
const styles = Object.fromEntries(
  [
    "workspace",
    "toolbar",
    "search",
    "pagination",
    "identity",
    "secretActions",
    "hint",
    "notice",
    "tableWrap",
    "table",
    "editor",
    "form",
    "check",
    "secretView",
    "srOnly",
  ].map((key) => [key, `users-${key}`]),
);

class UserRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function send(command: UserCommand) {
  const response = await fetch("/api/users", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await response.json();
  if (!response.ok)
    throw new UserRequestError(
      response.status,
      body.error || "No se pudo guardar. / Could not save.",
    );
  return body as {
    ok?: boolean;
    text?: string;
    version?: number;
    has_private_text?: boolean;
  };
}
function RoleSelect({
  locale,
  value,
  disabled = false,
}: {
  locale: Locale;
  value: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{t(locale, "Rol", "Role")}</span>
      <select name="role" defaultValue={value} disabled={disabled} required>
        {managedRoles.map((role) => (
          <option key={role} value={role}>
            {roleLabels[role]}
          </option>
        ))}
      </select>
    </label>
  );
}
function PasswordFields({ locale }: { locale: Locale }) {
  return (
    <>
      <label className="field">
        <span>
          {t(
            locale,
            "Nueva contraseña (12–128 caracteres)",
            "New password (12–128 characters)",
          )}
        </span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </label>
      <label className="field">
        <span>{t(locale, "Confirmar contraseña", "Confirm password")}</span>
        <input
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </label>
    </>
  );
}
function passwordFrom(form: HTMLFormElement, locale: Locale) {
  const fields = new FormData(form);
  const password = String(fields.get("password"));
  if (password !== fields.get("confirmation"))
    throw new Error(
      t(locale, "Las contraseñas no coinciden.", "Passwords do not match."),
    );
  return password;
}
function CreateUser({
  locale,
  close,
  created,
}: {
  locale: Locale;
  close: () => void;
  created: () => void;
}) {
  const pending = useRef<Extract<UserCommand, { action: "create" }> | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [locked, setLocked] = useState(false);
  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setBusy(true);
    try {
      if (!pending.current) {
        const password = passwordFrom(form, locale),
          data = new FormData(form);
        pending.current = {
          action: "create",
          request_id: crypto.randomUUID(),
          name: String(data.get("name")).trim(),
          email: String(data.get("email")).trim().toLowerCase(),
          role: data.get("role") as ManagedUser["role"],
          password,
        };
      }
      await send(pending.current);
      pending.current = null;
      form.reset();
      created();
    } catch (e) {
      const uncertain =
        !!pending.current &&
        (!(e instanceof UserRequestError) || e.status >= 500);
      setLocked(uncertain);
      if (!uncertain) pending.current = null;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t(locale, "Crear usuario", "Create user")}
      close={close}
      locale={locale}
      busy={busy}
      dirty={false}
    >
      <ProtectedForm className={styles.form} busy={busy} onSubmit={submit}>
        <p className={styles.hint}>
          {t(
            locale,
            "El usuario podrá ingresar con este correo y contraseña. En su primer acceso configurará el segundo factor.",
            "The user can sign in with this email and password and set up two-factor authentication on first access.",
          )}
        </p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {locked && (
          <p className={styles.hint} role="status">
            {t(
              locale,
              "El alta está pendiente de confirmación. Reintenta con los mismos datos; los campos se mantienen bloqueados para conservar la contraseña original.",
              "Creation is awaiting confirmation. Retry the same data; fields stay locked to preserve the original password.",
            )}
          </p>
        )}
        <fieldset
          className={styles.form}
          disabled={locked}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <label className="field">
            <span>{t(locale, "Nombre", "Name")}</span>
            <input name="name" autoComplete="off" maxLength={100} required />
          </label>
          <label className="field">
            <span>{t(locale, "Correo electrónico", "Email")}</span>
            <input
              name="email"
              type="email"
              autoComplete="off"
              maxLength={254}
              required
            />
          </label>
          <RoleSelect locale={locale} value="seller" />
          <PasswordFields locale={locale} />
        </fieldset>
        <div className="modal-footer">
          <button className="button primary" disabled={busy}>
            {busy
              ? t(locale, "Creando…", "Creating…")
              : locked
                ? t(locale, "Reintentar creación", "Retry creation")
                : t(locale, "Crear usuario", "Create user")}
          </button>
        </div>
      </ProtectedForm>
    </Modal>
  );
}
function AccessForm({
  user,
  actorId,
  locale,
  busy,
  save,
}: {
  user: ManagedUser;
  actorId: string;
  locale: Locale;
  busy: boolean;
  save: (command: UserCommand) => Promise<void>;
}) {
  const own = user.id === actorId;
  return (
    <ProtectedForm
      className={styles.form}
      busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget,
          fields = new FormData(form);
        await save({
          action: "access",
          user_id: user.id,
          role: fields.get("role") as ManagedUser["role"],
          active: fields.get("active") === "on",
          expected_role: user.role,
          expected_active: user.active,
        });
      }}
    >
      <RoleSelect locale={locale} value={user.role} disabled={own} />
      <label className={styles.check}>
        <input
          name="active"
          type="checkbox"
          defaultChecked={user.active}
          disabled={own}
        />
        {t(locale, "Usuario activo", "Active user")}
      </label>
      <p className={styles.hint}>
        {own
          ? t(
              locale,
              "Tu rol y tu estado no se pueden cambiar desde tu propia cuenta.",
              "You cannot change your own role or status.",
            )
          : t(
              locale,
              "Desactivar bloquea el acceso al CRM y conserva sus registros y asignaciones.",
              "Deactivation blocks CRM access and preserves records and assignments.",
            )}
      </p>
      <button className="button primary" disabled={own || busy}>
        {t(locale, "Guardar acceso", "Save access")}
      </button>
    </ProtectedForm>
  );
}
function PrivateText({
  user,
  locale,
  busy,
  save,
  message,
}: {
  user: ManagedUser;
  locale: Locale;
  busy: boolean;
  save: (command: UserCommand) => Promise<void>;
  message: (text: string, error?: boolean) => void;
}) {
  const [shown, setShown] = useState<string | null>(null),
    [reading, setReading] = useState(false),
    [clear, setClear] = useState(false);
  const generation = useRef(0);
  function conceal() {
    generation.current++;
    setShown(null);
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) conceal();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", conceal);
    return () => {
      generation.current++;
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", conceal);
    };
  }, []);
  useEffect(() => {
    if (shown === null) return;
    const timer = setTimeout(conceal, 30000);
    return () => clearTimeout(timer);
  }, [shown]);
  async function read(copy: boolean) {
    if (!copy && shown !== null) {
      conceal();
      return;
    }
    const current = ++generation.current;
    setReading(true);
    try {
      const result = await send({ action: "reveal", user_id: user.id });
      if (current !== generation.current) return;
      if (typeof result.text !== "string" || typeof result.version !== "number")
        throw new Error(
          t(locale, "Respuesta privada inválida.", "Invalid private response."),
        );
      if (copy) {
        await navigator.clipboard.writeText(result.text);
        if (current === generation.current)
          message(t(locale, "Texto privado copiado.", "Private text copied."));
      } else setShown(result.text);
    } catch {
      if (current === generation.current)
        message(
          t(
            locale,
            "No se pudo consultar o copiar el texto privado. Revisa tu acceso y los permisos del portapapeles.",
            "Could not read or copy private text. Check access and clipboard permissions.",
          ),
          true,
        );
    } finally {
      setReading(false);
    }
  }
  return (
    <div className={styles.form}>
      <div className={styles.secretView}>
        <label className="field">
          <span>
            {t(locale, "Texto privado guardado", "Saved private text")}
          </span>
          <input
            aria-label={t(
              locale,
              "Texto privado guardado",
              "Saved private text",
            )}
            type={shown === null ? "password" : "text"}
            readOnly
            value={shown ?? (user.has_private_text ? "••••••••" : "")}
            placeholder={t(locale, "Sin texto guardado", "No saved text")}
            autoComplete="off"
          />
        </label>
        <div className={styles.secretActions}>
          <button
            type="button"
            className="button"
            disabled={!user.has_private_text || reading || busy}
            aria-label={
              shown === null
                ? t(locale, "Mostrar texto privado", "Show private text")
                : t(locale, "Ocultar texto privado", "Hide private text")
            }
            aria-pressed={shown !== null}
            onClick={() => void read(false)}
          >
            {shown === null ? <Eye size={17} /> : <EyeOff size={17} />}
            {shown === null
              ? t(locale, "Mostrar", "Show")
              : t(locale, "Ocultar", "Hide")}
          </button>
          <button
            type="button"
            className="button"
            disabled={!user.has_private_text || reading || busy}
            onClick={() => void read(true)}
          >
            <Copy size={17} />
            {t(locale, "Copiar", "Copy")}
          </button>
        </div>
      </div>
      <p className={styles.hint}>
        {t(
          locale,
          "Solo superadmin puede consultarlo. Se vuelve a ocultar al salir de esta ventana o después de 30 segundos.",
          "Only superadmins can read this. It is hidden again when leaving this window or after 30 seconds.",
        )}
      </p>
      <ProtectedForm
        className={styles.form}
        busy={busy || reading}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          conceal();
          await save({
            action: "private_text",
            user_id: user.id,
            text: clear ? "" : String(new FormData(form).get("private_text")),
            expected_version: user.private_version,
          });
        }}
      >
        <label className="field">
          <span>{t(locale, "Nuevo texto privado", "New private text")}</span>
          <input
            name="private_text"
            type="password"
            autoComplete="new-password"
            maxLength={4000}
            required={!clear}
            disabled={clear}
            placeholder={t(
              locale,
              "Escribe un valor para reemplazarlo",
              "Enter a replacement value",
            )}
          />
        </label>
        {user.has_private_text && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={clear}
              onChange={(event) => setClear(event.target.checked)}
            />
            {t(
              locale,
              "Eliminar el texto privado guardado",
              "Clear the saved private text",
            )}
          </label>
        )}
        <button className="button primary" disabled={busy || reading}>
          {t(locale, "Guardar texto privado", "Save private text")}
        </button>
      </ProtectedForm>
    </div>
  );
}
function UserEditor({
  initial,
  actorId,
  locale,
  demo,
  close,
  updated,
}: {
  initial: ManagedUser;
  actorId: string;
  locale: Locale;
  demo: boolean;
  close: () => void;
  updated: () => void;
}) {
  const [user, setUser] = useState(initial),
    [tab, setTab] = useState("access"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const { requestLeave, confirmation } = useLeaveConfirmation(locale);
  const formContainer = useRef<HTMLDivElement>(null);
  function message(text: string, failed = false) {
    setError(failed ? text : "");
    setNotice(failed ? "" : text);
  }
  async function save(command: UserCommand) {
    setBusy(true);
    message("");
    try {
      if (demo)
        throw new Error(
          t(
            locale,
            "La demostración no modifica accesos ni almacena textos privados.",
            "The demo does not change access or store private text.",
          ),
        );
      const result = await send(command);
      if (command.action === "access")
        setUser((p) => ({ ...p, role: command.role, active: command.active }));
      if (command.action === "private_text") {
        if (typeof result.version !== "number")
          throw new Error(
            t(
              locale,
              "No se pudo confirmar el guardado.",
              "Could not confirm the save.",
            ),
          );
        setUser((p) => ({
          ...p,
          private_version: result.version!,
          has_private_text: command.text !== "",
        }));
      }
      formContainer.current?.querySelectorAll("form").forEach((form) => {
        form.reset();
        form.dispatchEvent(new Event("crm:form-saved"));
      });
      message(t(locale, "Cambios guardados.", "Changes saved."));
      updated();
    } catch (e) {
      message((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t(locale, "Administrar usuario", "Manage user")}
      close={close}
      locale={locale}
      busy={busy}
      dirty={false}
    >
      <div className={styles.identity}>
        <Avatar name={user.name} />
        <div>
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </div>
      </div>
      {demo && (
        <p className={styles.hint}>
          {t(
            locale,
            "Vista de demostración; los cambios requieren el entorno real.",
            "Demo view; changes require the live environment.",
          )}
        </p>
      )}
      <div
        className="section-tabs"
        role="tablist"
        aria-label={t(
          locale,
          "Administración del usuario",
          "User administration",
        )}
      >
        {[
          ["access", t(locale, "Acceso", "Access")],
          ["password", t(locale, "Contraseña", "Password")],
          ["private", t(locale, "Texto privado", "Private text")],
        ].map(([key, label]) => (
          <button
            key={key}
            id={`user-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`user-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            className={tab === key ? "active" : ""}
            disabled={busy}
            onKeyDown={(event) => {
              const keys = ["access", "password", "private"];
              const index = keys.indexOf(key);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % 3
                  : event.key === "ArrowLeft"
                    ? (index + 2) % 3
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : null;
              if (next === null) return;
              event.preventDefault();
              const parent = event.currentTarget.parentElement;
              requestLeave(() => {
                setTab(keys[next]);
                message("");
                parent
                  ?.querySelector<HTMLButtonElement>(`#user-tab-${keys[next]}`)
                  ?.focus();
              }, formContainer.current);
            }}
            onClick={() =>
              requestLeave(() => {
                setTab(key);
                message("");
              }, formContainer.current)
            }
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <p role="status" className={styles.notice}>
        {notice}
      </p>
      <div
        ref={formContainer}
        role="tabpanel"
        id={`user-panel-${tab}`}
        aria-labelledby={`user-tab-${tab}`}
        className={styles.editor}
      >
        {tab === "access" && (
          <AccessForm
            key={`${user.role}:${user.active}`}
            user={user}
            actorId={actorId}
            locale={locale}
            busy={busy || demo}
            save={save}
          />
        )}
        {tab === "password" && (
          <ProtectedForm
            className={styles.form}
            busy={busy || demo}
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await save({
                  action: "password",
                  user_id: user.id,
                  password: passwordFrom(event.currentTarget, locale),
                });
              } catch (e) {
                message((e as Error).message, true);
              }
            }}
          >
            <p className={styles.hint}>
              {t(
                locale,
                "Establece una contraseña nueva. La contraseña anterior no se puede consultar.",
                "Set a new password. The previous password cannot be retrieved.",
              )}
            </p>
            <PasswordFields locale={locale} />
            <button className="button primary" disabled={busy || demo}>
              <KeyRound size={16} />
              {t(locale, "Cambiar contraseña", "Change password")}
            </button>
          </ProtectedForm>
        )}
        {tab === "private" && (
          <PrivateText
            key={user.private_version}
            user={user}
            locale={locale}
            busy={busy || demo}
            save={save}
            message={message}
          />
        )}
      </div>
      {confirmation}
    </Modal>
  );
}
type Props = {
  profile: Profile;
  locale: Locale;
  demo?: boolean;
  profiles?: Profile[];
  onUpdated?: () => void;
};
export function UserManagement(props: Props) {
  if (!canManageUsers(props.profile, props.demo))
    return (
      <Empty
        title={t(props.locale, "Acceso restringido", "Access restricted")}
      />
    );
  return <UserManagementContent {...props} />;
}
function UserManagementContent({
  profile,
  locale,
  demo = false,
  profiles = [],
  onUpdated,
}: Props) {
  const [page, setPage] = useState<UserPage>({ items: [], total: 0, page: 0 }),
    [pageNumber, setPageNumber] = useState(0),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(!demo),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<ManagedUser | "create" | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (demo) {
      const items = profiles.filter((p) =>
        `${p.name} ${p.email}`.toLowerCase().includes(search.toLowerCase()),
      );
      setPage({
        items: items.slice(pageNumber * 25, (pageNumber + 1) * 25).map((p) => ({
          ...p,
          active: p.active !== false,
          has_private_text: false,
          private_version: 0,
        })),
        total: items.length,
        page: pageNumber,
      });
      return;
    }
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(
          `/api/users?${new URLSearchParams({ q: search, page: String(pageNumber) })}`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error ||
              t(
                locale,
                "No se pudo cargar el equipo.",
                "Could not load users.",
              ),
          );
        const next = userPageSchema.parse(body);
        if (!controller.signal.aborted) setPage(next);
      } catch (e) {
        if (!controller.signal.aborted) {
          setPage({ items: [], total: 0, page: pageNumber });
          setError((e as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [demo, search, pageNumber, revision]);
  return (
    <section
      className={`panel ${styles.workspace}`}
      aria-label={t(locale, "Administración de usuarios", "User management")}
      aria-busy={loading}
    >
      <div className={styles.toolbar}>
        <div>
          <h2>
            <ShieldCheck size={20} />
            {t(locale, "Usuarios y accesos", "Users and access")}
          </h2>
          <p className={styles.hint}>
            {t(
              locale,
              "Administra roles, contraseñas y un texto privado por persona.",
              "Manage roles, passwords and private text for each person.",
            )}
          </p>
        </div>
        <button
          className="button primary"
          disabled={demo}
          onClick={() => {
            setNotice("");
            setEditor("create");
          }}
        >
          <Plus size={17} />
          {t(locale, "Crear usuario", "Create user")}
        </button>
      </div>
      {demo && (
        <p className={styles.hint}>
          {t(
            locale,
            "Demostración con datos ficticios. La creación y los cambios de acceso están deshabilitados.",
            "Fictional demo. User creation and access changes are disabled.",
          )}
        </p>
      )}
      <form
        className={styles.search}
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
          setPageNumber(0);
        }}
      >
        <label className="field">
          <span>
            {t(locale, "Buscar por nombre o correo", "Search by name or email")}
          </span>
          <input
            type="search"
            maxLength={100}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="button" disabled={loading}>
          <Search size={16} />
          {t(locale, "Buscar", "Search")}
        </button>
        <button
          type="button"
          className="button"
          aria-label={t(locale, "Actualizar usuarios", "Refresh users")}
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </form>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <p role="status" className={styles.notice}>
        {notice ||
          (loading
            ? t(locale, "Cargando usuarios…", "Loading users…")
            : error
              ? t(locale, "Lista no disponible.", "List unavailable.")
              : t(locale, `${page.total} usuarios`, `${page.total} users`))}
      </p>
      {!loading && !error && page.items.length === 0 && (
        <Empty
          title={t(
            locale,
            "No hay usuarios con esta búsqueda",
            "No users match this search",
          )}
          body={t(
            locale,
            "Prueba otro nombre o correo.",
            "Try another name or email.",
          )}
        />
      )}
      {page.items.length > 0 && !loading && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t(locale, "Usuario", "User")}</th>
                <th>{t(locale, "Rol", "Role")}</th>
                <th>{t(locale, "Estado", "Status")}</th>
                <th>
                  <span className={styles.srOnly}>
                    {t(locale, "Acciones", "Actions")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className={styles.identity}>
                      <Avatar name={user.name} small />
                      <div>
                        <strong>{user.name}</strong>
                        <small>{user.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge">{roleLabels[user.role]}</span>
                  </td>
                  <td>
                    {user.active
                      ? t(locale, "Activo", "Active")
                      : t(locale, "Inactivo", "Inactive")}
                  </td>
                  <td>
                    <button
                      className="button"
                      aria-label={t(
                        locale,
                        `Administrar a ${user.name}`,
                        `Manage ${user.name}`,
                      )}
                      onClick={() => setEditor(user)}
                    >
                      {t(locale, "Administrar", "Manage")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.pagination}>
        <span>
          {t(locale, `Página ${pageNumber + 1}`, `Page ${pageNumber + 1}`)}
        </span>
        <div>
          <button
            className="button"
            disabled={loading || pageNumber === 0}
            onClick={() => setPageNumber((v) => v - 1)}
          >
            {t(locale, "Anterior", "Previous")}
          </button>
          <button
            className="button"
            disabled={loading || (pageNumber + 1) * 25 >= page.total}
            onClick={() => setPageNumber((v) => v + 1)}
          >
            {t(locale, "Siguiente", "Next")}
          </button>
        </div>
      </div>
      {editor === "create" && (
        <CreateUser
          locale={locale}
          close={() => setEditor(null)}
          created={() => {
            setEditor(null);
            setNotice(
              t(
                locale,
                "Usuario creado. Su contraseña no se almacena en el texto privado.",
                "User created. Its password is not stored in private text.",
              ),
            );
            setRevision((v) => v + 1);
            onUpdated?.();
          }}
        />
      )}
      {editor && editor !== "create" && (
        <UserEditor
          key={editor.id}
          initial={editor}
          actorId={profile.id}
          locale={locale}
          demo={demo}
          close={() => setEditor(null)}
          updated={() => {
            setRevision((v) => v + 1);
            onUpdated?.();
          }}
        />
      )}
    </section>
  );
}
