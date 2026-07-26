import { useQuery } from '@tanstack/react-query';
import { grahaApi, type Deal } from './api/modules';

export function probe() {
  const q = useQuery<Deal[]>({ queryKey: ['graha', 'deals'], queryFn: grahaApi.deals });
  const bad: number = q.data;
  return bad;
}
