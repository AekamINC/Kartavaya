export type Role           = 'admin' | 'owner' | 'member' | 'client';
export type Priority       = 'urgent' | 'high' | 'medium' | 'low';
export type ApprovalStatus = 'pending' | 'pending_client' | 'approved' | 'rejected' | null;
export type TaskStatus     = 'todo' | 'in_progress' | 'in_review' | 'done' | 'requested';
export type PushMode       = 'always' | 'mine_only' | 'project' | 'off';
export type NotifKind      =
  | 'mention' | 'approval_request' | 'approved' | 'rejected'
  | 'assigned' | 'comment' | 'status_changed' | 'done' | 'created';
export type NotifPrefs     = Partial<Record<NotifKind, PushMode>>;

export interface User {
  user_id:                  string;
  email:                    string;
  name?:                    string;
  full_name?:               string;
  role:                     Role;
  picture?:                 string;
  position?:                string;
  member_role?:             string;
  company_name?:            string;
  receives_approval_emails: boolean;
}

export interface Project {
  team_id:      string;
  name:         string;
  description?: string;
  created_by:   string;
  created_at:   string;
  updated_at:   string;
  task_count:   number;
  done_count:   number;
  color?:       string;
  deleted_at?:  string;
}

export interface ProjectColumn {
  column_id:  string;
  team_id:    string;
  name:       string;
  color:      string;
  sort_order: number;
  is_done:    boolean;
}

export interface Subtask {
  subtask_id:       string;
  title:            string;
  is_done:          boolean;
  order:            number;
  assignee_user_id?: string;
}

export interface Attachment {
  name:  string;
  url:   string;
  key?:  string;
}

export interface Task {
  task_id:              string;
  team_id:              string;
  team_name?:           string;
  column_id:            string;
  created_by_user_id:   string;
  created_by_name?:     string;
  assigned_by_user_id?: string;
  title:                string;
  description?:         string;
  status:               TaskStatus;
  priority:             Priority;
  tags:                 string[];
  assignee_user_ids:    string[];
  due_at?:              string;
  attachments:          Attachment[];
  subtasks:             Subtask[];
  order:                number;
  created_at:           string;
  updated_at:           string;
  completed_at?:        string;
  approval_status:      ApprovalStatus;
  approval_notes?:      string;
  approved_by?:         string;
  category_id?:         string;
  comments_count?:      number;
  assignee_names?:      string[];
}

/**
 * What `GET /api/client/tasks` actually returns — `ClientTaskOut`
 * (`backend/server.py:609`), NOT `Task`.
 *
 * The two shapes share exactly one field name, `title`, which is why annotating
 * the call as `Task[]` looked fine: the list rendered, with every other cell
 * blank. `apiClient.get<T>()` is an unchecked cast, so TypeScript could not
 * catch it either.
 *
 * The server serialises camelCase via Pydantic aliases while keeping snake_case
 * internally, so these names are the wire names and are deliberately different
 * from `Task`'s. `status` in particular has no counterpart: six internal
 * statuses collapse to three client states, and the raw one does not cross.
 */
export type ClientState = 'with_us' | 'with_you' | 'done';

export interface ClientAttachment {
  name:       string;
  url:        string;
  size?:      number | null;
  sharedBy?:  string | null;
  sharedAt?:  string | null;
}

export interface ClientTask {
  taskId:       string;
  ref:          string;
  title:        string;
  /** `TaskOut.description`. */
  note:         string;
  /** `TaskOut.status`, reduced to the three states a client is shown. */
  state:        ClientState;
  /** `TaskOut.due_at`. */
  expectedAt?:  string | null;
  updatedAt?:   string | null;
  createdAt?:   string | null;
  requestedBy?: string | null;
  projectId?:   string | null;
  /** `TaskOut.attachments`, already filtered for private files server-side. */
  files:        ClientAttachment[];
  decision?:    { outcome: string; note: string; at?: string | null } | null;
  awaitingMe:   boolean;
}

export interface Comment {
  comment_id: string;
  task_id:    string;
  user_id:    string;
  user_name:  string;
  body:       string;
  created_at: string;
}

export interface TeamMember {
  user_id?:      string;
  member_id?:    string;
  email:         string;
  display_name?: string;
  full_name?:    string;
  name?:         string;
  role:          Role;
  member_role?:  string;
  position?:     string;
  company_name?: string;
  status:        string;
  receives_approval_emails?: boolean;
}

export interface Notification {
  notification_id: string;
  user_id:         string;
  team_id?:        string;
  task_id?:        string;
  type:            NotifKind;
  title:           string;
  message:         string;
  url?:            string;
  created_at:      string;
  read_at?:        string;
}

export interface NotifPrefsResponse {
  prefs:       NotifPrefs;
  quiet_start: string;  // "22:00"
  quiet_end:   string;  // "07:00"
}

export interface TaskTemplateConfig {
  title?:       string;
  description?: string;
  priority?:    Priority;
  subtasks?:    { title: string }[];
  attachments?: { name: string; url: string; key?: string }[];
  tags?:        string[];
}

export interface TaskTemplate {
  template_id: string;
  team_id?:    string | null;
  name:        string;
  icon?:       string;
  is_default:  boolean;
  config:      TaskTemplateConfig;
  created_by:  string;
  created_at:  string;
  updated_at?: string;
}

export interface MutationQueueItem {
  id:           string;
  method:       'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url:          string;
  body?:        unknown;
  optimistic_id?: string;
  created_at:   string;
  retries:      number;
}
