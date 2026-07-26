/**
 * ClientBoardPage — the lazy split point for `/client/project/:projectId`.
 *
 * Still named "Board" because `App.jsx:59` imports it under that name and
 * `App.jsx` is outside this change's ownership. There is no board behind it any
 * more: `19-client-portal.md` rules out a kanban on this surface, and the one
 * that used to render here fetched the project's full member list and every
 * task in it. See `pages/client/ClientProject.jsx`.
 */
export { ClientProjectBoardPage as default } from './ClientPages';
