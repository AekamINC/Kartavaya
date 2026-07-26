import { apiClient } from './client';

/**
 * Pahchan · पहचान — attendance.
 *
 * Mirrors `backend/routers/pahchan.py`. Field names are 07 §4's punch contract
 * exactly; `captured_at` is the device clock at capture and `received_at` is the
 * server's, and the two are never interchanged.
 */

export type PunchDirection = 'in' | 'out';
export type PunchFlag = 'late' | 'geo' | 'noref' | 'accuracy' | 'offline' | 'overtime' | 'mock';

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
