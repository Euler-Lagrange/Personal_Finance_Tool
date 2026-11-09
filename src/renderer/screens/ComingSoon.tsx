import { Card } from "../components/ui";

/** A screen that is planned but not built yet. Says so plainly instead of showing dead controls. */
export function ComingSoon({ milestone, title, points }: { milestone: number; title: string; points: string[] }) {
  return (
    <Card title={`${title} arrives in milestone ${milestone}`} className="coming">
      <ul>
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Card>
  );
}
