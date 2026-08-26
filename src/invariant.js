export const name = "video-sherlock-app-invariant"
export const inject = ['appConversations']
export function apply(ctx) {
  if (ctx.get('appConversations') === undefined) throw new Error("video-sherlock-app requires the DeepDeck Apps runtime")
}
