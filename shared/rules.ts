/**
 * Who may change what. The API enforces these; the UI uses the same
 * functions to decide which menus and buttons to show.
 */
export interface Viewer {
  id: number
}

export const canEditPost = (viewer: Viewer | null, post: { authorId: number }) => !!viewer && viewer.id === post.authorId

export const canDeletePost = canEditPost

export const canEditComment = (viewer: Viewer | null, comment: { authorId: number }) =>
  !!viewer && viewer.id === comment.authorId

/** The comment's author, or the author of the post it's on (to remove unwanted replies). */
export const canDeleteComment = (viewer: Viewer | null, comment: { authorId: number }, post: { authorId: number }) =>
  !!viewer && (viewer.id === comment.authorId || viewer.id === post.authorId)

export const RULES: { action: string; who: string }[] = [
  { action: 'Read the feed, profiles and comments', who: 'Any signed-in user' },
  { action: 'Create a post, comment or reaction', who: 'Any signed-in user' },
  { action: 'Edit or delete a post', who: 'Only the post’s author' },
  { action: 'Edit a comment', who: 'Only the comment’s author' },
  { action: 'Delete a comment', who: 'The comment’s author, or the author of the post it’s on' },
  { action: 'Edit a profile or avatar', who: 'Only that user' },
  { action: 'React to a post', who: 'Any signed-in user, one reaction each (can be changed or removed)' },
]
