import { render, screen } from '@testing-library/svelte';
import ChallengeCard from '$lib/components/games/challenge-card.svelte';

describe('ChallengeCard', () => {
  const base = { name: 'Summer', roundCount: 5, answered: 0, href: '/x' };

  it('renders the challenge name', () => {
    render(ChallengeCard, base);
    expect(screen.getByTestId('challenge-card')).toBeInTheDocument();
    expect(screen.getByText('Summer')).toBeInTheDocument();
  });

  it('shows a delete control when a delete handler is supplied', () => {
    render(ChallengeCard, { ...base, onDelete: () => {} });
    expect(screen.getByTestId('challenge-card-delete')).toBeInTheDocument();
  });

  // Proves the negative honestly: the positive case above shows the control CAN
  // render, so its absence here is a real signal rather than a always-null query.
  it('hides the delete control for a viewer', () => {
    render(ChallengeCard, base);
    expect(screen.queryByTestId('challenge-card-delete')).not.toBeInTheDocument();
  });
});
