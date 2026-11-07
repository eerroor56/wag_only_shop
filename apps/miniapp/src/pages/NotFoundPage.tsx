import { Link } from 'react-router';
import { EmptyState } from '@wag/web';

export function NotFoundPage() {
  return (
    <div className="container">
      <EmptyState
        title="Страница не найдена"
        action={
          <Link to="/" className="btn btn-primary">
            На главную
          </Link>
        }
      />
    </div>
  );
}
