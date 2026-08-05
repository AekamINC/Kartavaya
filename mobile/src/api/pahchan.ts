import { apiClient } from './client';

/**
 * Pahchan · पहचान — attendance.
 *
 * Mirrors `backend/routers/pahchan.py`. Field names are 07 §4's punch contract
 * exactly; `captured_at` is the device clock at capture and `received_at` is the
 * server's, and the two are never interchanged.
 */

export type PunchDirection = 'in' | 'out';
export type PunchFlag =
  | 'late' | 'geo' | 'noref' | 'accuracy' | 'offline' | 'overtime' | 'mock'
  // The same photograph on more than one punch. Set by the server, never the
  // client — 07 §1's camera-only rule is a UI control, and the API is the
  // boundary that actually has to hold.
  | 'reuse';

export interface Punch {
  id:              string;
  direction:       PunchDirection;
  captured_at:     string;
  received_at:     string;
  source:          'live' | 'offline';
  flags:           PunchFlag[];
  accuracy_m:      number | null;
  distance_m:      number | null;
  review_verdict:  'ok' | 'flagged' | null;
}

export interface RetentionPromise {
  punch_photo_days:           number;
  reference_photo_grace_days: number;
  record_retention_years:     number;
}

export interface MyAttendance {
  employee:  { id: string; name: string } | null;
  punches:   Punch[];
  retention: RetentionPromise;
}

export const pahchanApi = {
  /**
   * Upload a capture, get its object key back.
   *
   * Returns a KEY, never a URL — 07 §4. Keys are inert; a URL in a log or a cache
   * is an exposure, so URLs are minted per view and expire.
   */
  uploadPhoto: async (uri: string, kind: 'punch' | 'reference' = 'punch') => {
    const form = new FormData();
    // RN's FormData takes this shape for a local file; there is no Blob to read.
    form.append('file', { uri, name: 'capture.jpg', type: 'image/jpeg' } as never);
    form.append('kind', kind);
    const r = await apiClient.post<{ photo_key: string; size: number }>(
      '/v1/pahchan/punch/photo',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return r.data;
  },

  punch: (body: {
    direction:       PunchDirection;
    captured_at:     string;
    lat?:            number;
    lng?:            number;
    accuracy_m?:     number;
    site_id?:        string | null;
    photo_key?:      string | null;
    device_id?:      string | null;
    mock_location?:  boolean | null;
    source?:         'live' | 'offline';
    client_punch_id: string;
  }) =>
    apiClient.post<{ punch: Punch; duplicate: boolean }>('/v1/pahchan/punch', body)
      .then(r => r.data),

  /** The signed-in employee's own record. Carries no photo keys. */
  me: (days = 30) =>
    apiClient.get<MyAttendance>('/v1/pahchan/me', { params: { days } }).then(r => r.data),

  sites: () =>
    apiClient.get<{ data: { id: string; name: string; lat: number; lng: number; radius_m: number }[] }>(
      '/v1/pahchan/sites',
    ).then(r => r.data.data),
};

// ── Corrections ───────────────────────────────────────────────────────────────

/**
 * What `POST /api/v1/pahchan/regularisations` returns on 201. Deliberately not
 * the whole row — the endpoint's `RETURNING` clause is these five columns.
 */
export interface CorrectionCreated {
  id:                  string;
  for_date:            string;
  requested_direction: PunchDirection;
  status:              'pending';
  created_at:          string;
}

export const correctionsApi = {
  /**
   * Ask for a day to be corrected.
   *
   * The body is built by `screens/pahchan/corrections.ts`, which is where every
   * rule about its contents lives — this is only the wire.
   *
   * There is deliberately no `list` here. `GET /regularisations` is gated on
   * `require_org_role('org_owner','org_admin')`, so an employee calling it gets a
   * 403; the queue is a reviewer's screen. What THIS phone asked for is kept
   * locally instead, and labelled as exactly that.
   */
  request: (body: {
    employee_id:         string;
    for_date:            string;
    requested_direction: PunchDirection;
    requested_at_time:   string;
    reason:              string;
    punch_id?:           string;
  }) =>
    apiClient.post<CorrectionCreated>('/v1/pahchan/regularisations', body).then(r => r.data),
};

// ── Enrollment ────────────────────────────────────────────────────────────────

export interface ReferencePhoto {
  id:          string;
  slot:        1 | 2;
  object_key:  string;
  source:      'hr_upload' | 'self_capture';
  captured_at: string;
  approved_at: string | null;
  approved_by: string | null;
}

export interface Enrollment {
  photos:           ReferencePhoto[];
  /** True only when TWO photos are APPROVED. A pending self-capture is not yet
   *  something a reviewer can compare against, so it does not count. */
  complete:         boolean;
  pending_approval: number;
}

export const enrollmentApi = {
  get: (employeeId: string) =>
    apiClient.get<Enrollment>(`/v1/pahchan/enrollment/${employeeId}`).then(r => r.data),

  /** Self-capture. The server rejects any employee_id but the caller's own. */
  submit: (body: { employee_id: string; slot: 1 | 2; object_key: string }) =>
    apiClient.post('/v1/pahchan/enrollment', { ...body, source: 'self_capture' })
      .then(r => r.data),

  /**
   * A short-lived signed URL for one reference photograph.
   *
   * By row id, never by object key — there is deliberately no endpoint anywhere
   * that will sign an arbitrary key handed to it. Employees may always read
   * their own (07 §9); anyone else's needs an org admin.
   */
  photoUrl: (photoId: string) =>
    apiClient.get<{ url: string }>(`/v1/pahchan/enrollment/photos/${photoId}/url`)
      .then(r => r.data.url),
};
