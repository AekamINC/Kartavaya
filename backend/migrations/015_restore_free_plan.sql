-- ============================================================
-- Migration 015: Restore free plan — core PM only, no Srijan
-- Free users get tasks/projects/kanban/docs.
-- Srijan requires a paid plan (starter/growth/scale).
-- ============================================================

UPDATE staging.plans SET is_active = TRUE,
  features = '{"tasks": true, "projects": true, "docs": true, "kanban": true, "srijan": false}'
WHERE code = 'free';

UPDATE staging.plans SET features = jsonb_set(features, '{srijan}', 'true')
WHERE code IN ('starter', 'growth', 'scale');
