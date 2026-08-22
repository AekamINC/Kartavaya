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
  /** Metres above sea level as the DEVICE reported it, and how sure it was.
   *  Both are null on a device that reports no altitude — ordinary indoors, and
   *  permanent on some Android hardware. Never 0: 0 is sea level, and a site
   *  above it would flag every punch from a phone that simply could not say. */
  altitude_m?:          number | null;
  altitude_accuracy_m?: number | null;
  review_verdict:  'ok' | 'flagged' | null;
}

/**
 * One site as the employee's own screen may see it — `GET /me` -> `rules.sites`.
 *
 * A place, not a person: this is the one part of `rules` that names anything at
 * all, and a site name is what lets somebody work out which fence they were
 * inside. No ids of any kind.
 */
export interface RuleSite {
  name:                 string;
  radius_m:             number | null;
  altitude_m:           number | null;
  altitude_tolerance_m: number | null;
  /** True only when the site has BOTH an altitude and a tolerance. An altitude
   *  with no tolerance is recorded and not checked, which is a third state. */
  checks_altitude:      boolean;
}

/**
 * The rules this employee is actually judged by.
 *
 * Every rule in this module was visible to the org and invisible to the person
 * it decides about: the Policy screen is behind an org-admin gate, and the
 * employee's own register showed flags with no numbers behind any of them. A
 * "geo" flag on an honest punch is a question an employee cannot answer without
 * the figure they missed by.
 *
 * Optional on the type because a build newer than its backend must render the
 * rest of the Me tab rather than crash on a missing key — and because every
 * figure here is the ORG'S, read from its saved policy. A client-side default
 * would be a promise about a different system.
 */
export interface AttendanceRules {
  grace_minutes:             number | null;
  accuracy_flag_threshold_m: number | null;
  allow_outside_geofence:    boolean | null;
  standard_hours_per_day:    number | null;
  overtime_enabled:          boolean | null;
  sites:                     RuleSite[];
  /** Flag code -> a plain-English sentence, written by the server so the phone
   *  and the reviewer's screen cannot drift into two vocabularies. */
  flag_meanings:             Record<string, string>;
  /** 07 §2, said out loud: a flag asks somebody to look, it never refuses. */
  nothing_is_refused:        boolean;
}

export interface RetentionPromise {
  punch_photo_days:           number;
  reference_photo_grace_days: number;
  record_retention_years:     number;
}

/**
 * Whether this employee has been served the DPDP notice, and which wording.
 *
 * `acknowledged_at` is null when they have not — which is what puts the notice
 * in front of the camera on `ClockScreen`. It is ALSO null when migration 111
 * has not been applied, because the server cannot distinguish "no row" from "no
 * table" and refuses to guess: showing a notice twice is a nuisance, recording
 * an acknowledgement that never happened is not.
 */
export interface NoticeState {
  version:         string;
  acknowledged_at: string | null;
}

export interface MyAttendance {
  employee:  { id: string; name: string } | null;
  punches:   Punch[];
  retention: RetentionPromise;
  /** Absent on a backend older than the notice. Treated as "not acknowledged". */
  notice?:   NoticeState;
  /** Absent on a backend older than the rules block. The section simply does
   *  not render — never a hardcoded radius or threshold in its place. */
  rules?:    AttendanceRules;
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
    /** Metres above sea level, and the device's own uncertainty about it. Both
     *  stay UNDEFINED when the fix carried none — sending 0 would place the
     *  punch at sea level and flag every one made at a site above it. The
     *  server stores whatever arrives whether or not the site checks height. */
    altitude_m?:          number;
    altitude_accuracy_m?: number;
    site_id?:        string | null;
    photo_key?:      string | null;
    device_id?:      string | null;
    mock_location?:  boolean | null;
    source?:         'live' | 'offline';
    client_punch_id: string;
  }) =>
    apiClient.post<{ punch: Punch; duplicate: boolean }>('/v1/pahchan/punch', body)
      .then(r => r.data),

  /**
   * The signed-in employee's own record. Carries no photo keys.
   *
   * `notice_version` is sent so the server answers about the wording THIS build
   * renders. Asking about the server's own constant would tell somebody who has
   * already read the notice in front of them that they have not.
   */
  me: (days = 30, noticeVersion?: string) =>
    apiClient.get<MyAttendance>('/v1/pahchan/me', {
      params: noticeVersion ? { days, notice_version: noticeVersion } : { days },
    }).then(r => r.data),

  /**
   * Record that the DPDP notice was served.
   *
   * ANSWERS 200 WITH `stored: false` when `staging.pahchan_notice_acks` does not
   * exist — migration 111 is unapplied. The caller must treat that as success
   * for the purpose of clearing its gate: this sits above the camera on
   * `ClockScreen`, and 07 §2 is that nothing blocks a punch.
   */
  acknowledgeNotice: (version: string, acknowledgedAt: string, wasOffline: boolean) =>
    apiClient.post<{ version: string; acknowledged_at: string | null; stored: boolean }>(
      '/v1/pahchan/notice/ack',
      {
        version,
        // The DEVICE clock at the tap, never re-stamped at sync time. Migration
        // 113's two clocks: this is the instant that must precede the first
        // photograph, and the server keeps its own `recorded_at` beside it.
        acknowledged_at: acknowledgedAt,
        source: 'mobile',
        was_offline: wasOffline,
      },
    ).then(r => r.data),

  sites: () =>
    apiClient.get<{
      data: {
        id: string; name: string; lat: number; lng: number; radius_m: number;
        // Nullable, and null is the common case — a site with no vertical pair
        // is judged on distance alone, which is the right default.
        altitude_m?: number | null;
        altitude_tolerance_m?: number | null;
        is_active?: boolean;
      }[];
    }>(
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

/** One of this employee's own correction requests, with what was decided. */
export interface MyCorrection {
  id:                  string;
  for_date:            string;
  requested_direction: PunchDirection;
  requested_at_time:   string;
  reason:              string;
  status:              'pending' | 'approved' | 'rejected';
  decided_at:          string | null;
  decision_note:       string | null;
  created_at:          string;
}

export const correctionsApi = {
  /**
   * Ask for a day to be corrected.
   *
   * The body is built by `screens/pahchan/corrections.ts`, which is where every
   * rule about its contents lives — this is only the wire.
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

  /**
   * This employee's own requests, and what was decided about them.
   *
   * NOT `GET /regularisations`, which is the reviewer's queue and is gated on
   * `require_org_role('org_owner','org_admin')` — an employee calling that gets
   * a 403. `/regularisations/mine` selects by joining the caller's user_id to
   * their employee record, so there is no id to pass and none to tamper with.
   *
   * Before this existed the register kept what THIS phone had asked for in
   * local state and told the employee "This app cannot show you their answer."
   * That was true, and it is the wrong thing for a product to say to somebody
   * whose missing clock-out cost them a day's pay.
   */
  mine: () =>
    apiClient.get<MyCorrection[]>('/v1/pahchan/regularisations/mine').then(r => r.data),
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
