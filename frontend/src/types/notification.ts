export type NotificationItem = {
  id: string;
  type: string;
  subject: string;
  body: string;
  target_type: string;
  target_id: string;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
};
