/**
 * useFields â€” fetch field definitions + values for a task/team, handle saves.
 */
import { logger } from '../lib/utils';
import { useState, useEffect, useCallback } from 'react';
import { api, rows } from '../lib/api';

export function useFieldDefs(teamId) {
  const [defs, setDefs]       = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    api.get(`/fields/team/${teamId}`)
       .then(r => setDefs(r.data))
       .catch(logger.error)
       .finally(() => setLoading(false));
  }, [teamId]);

  const createField = useCallback(async (payload) => {
    const res = await api.post('/fields/', { team_id: teamId, ...payload });
    setDefs(prev => [...prev, res.data]);
    return res.data;
  }, [teamId]);

  const updateField = useCallback(async (fieldId, patch) => {
    await api.put(`/fields/${fieldId}`, patch);
    setDefs(prev => prev.map(f => f.field_id === fieldId ? { ...f, ...patch } : f));
  }, []);

  const deleteField = useCallback(async (fieldId) => {
    await api.delete(`/fields/${fieldId}`);
    setDefs(prev => prev.filter(f => f.field_id !== fieldId));
  }, []);

  return { defs, loading, createField, updateField, deleteField };
}

export function useFieldValues(taskId) {
  const [values, setValues]   = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    api.get(`/fields/task/${taskId}/values`)
       .then(r => {
         const vals = {};
         rows(r).forEach(v => { vals[v.field_id] = v.value; });
         setValues(vals);
       })
       .catch(logger.error)
       .finally(() => setLoading(false));
  }, [taskId]);

  const setValue = useCallback(async (fieldId, value) => {
    setValues(prev => ({ ...prev, [fieldId]: value }));
    try {
      await api.put(`/fields/task/${taskId}/values`, [{ field_id: fieldId, value }]);
    } catch (e) {
      logger.error('Field value save failed', e);
    }
  }, [taskId]);

  return { values, loading, setValue };
}

/**
 * useFieldValueMap — every custom-field value on a board, in one request.
 *
 * `TableView` renders a cell per (task × visible custom field), so it needs the
 * whole matrix before it paints. `useFieldValues` above is per-TASK, which is
 * right for the drawer and wrong for a board: `ProjectBoardPage` was calling it
 * in a `Promise.all` over every task, so a 200-task board opened 200 requests
 * and only committed the map once the slowest settled. `BoardsPage` did not
 * fetch values at all, so every custom-field cell on `/boards` was blank —
 * `TableView` reads a `fieldValueMap` prop that page never passed.
 *
 * `GET /fields/team/:id/values` returns `{task_id: {field_id: value}}` already
 * shaped for the table, so there is nothing to regroup here.
 *
 * `enabled` exists because a board with no custom fields defined has no cells
 * to fill, and the request would return an empty object at the cost of a round
 * trip on every board load.
 */
export function useFieldValueMap(teamId, enabled = true) {
  const [map, setMap]         = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const reload = useCallback(() => {
    if (!teamId || !enabled) { setMap({}); return; }
    setLoading(true);
    setError(null);
    api.get(`/fields/team/${teamId}/values`)
       .then(r => setMap(r.data && typeof r.data === 'object' ? r.data : {}))
       .catch(e => {
         logger.error('Field value map load failed', e);
         setError(e);
         // Left as {} rather than stale: a value map from the PREVIOUS board
         // would render another project's answers against these task ids.
         setMap({});
       })
       .finally(() => setLoading(false));
  }, [teamId, enabled]);

  useEffect(() => { reload(); }, [reload]);

  return { map, loading, error, reload };
}

/**
 * Combined convenience hook â€” some components import { useFields }.
 * Returns { defs, fieldValues, loading, createField, updateField, deleteField, setValue }.
 */
export function useFields(teamId, taskId) {
  const fieldDefs   = useFieldDefs(teamId);
  const fieldValues = useFieldValues(taskId);
  return { ...fieldDefs, fieldValues: fieldValues.values, setValue: fieldValues.setValue };
}

