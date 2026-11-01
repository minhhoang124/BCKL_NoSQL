import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './StateCard.module.css';

type Action = { label: string; to: string } | { label: string; onClick: () => void };

/**
 * ui-orange-v1 / 18-states: one shared way to show empty, expired-session,
 * conflict and unavailable states — a short title, a plain explanation and
 * at most one secondary action. Never decides business state by itself.
 */
export function StateCard({
  title,
  children,
  action,
  role,
  primary = false,
}: {
  title: string;
  children: ReactNode;
  action?: Action;
  role?: 'status' | 'alert';
  primary?: boolean;
}) {
  const actionClass = primary ? `${styles.action} ${styles.primary}` : styles.action;
  return (
    <section className={styles.card} role={role}>
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.body}>{children}</div>
      {action &&
        ('to' in action ? (
          <Link className={actionClass} to={action.to}>
            {action.label}
          </Link>
        ) : (
          <button type="button" className={actionClass} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
    </section>
  );
}
