/** A failed read, in the new style: the message names the page and field (ParseError) or the URL and status (HttpError). */
export function ErrorNote({ error }: { error: Error }) {
  return (
    <div class="errnote" role="status">
      <span class="errdot" aria-hidden="true" />
      <span>{error.message}</span>
    </div>
  );
}
