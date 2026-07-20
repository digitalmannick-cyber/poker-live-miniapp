const socialService = require('../../services/social-service')
const { POKER_STICKER_IDS, POKER_STICKERS, POKER_STICKER_BY_ID } = require('../../utils/poker-stickers')

const SCOPES = ['square', 'friends', 'selected']
const SCOPE_LABELS = { square: '广场', friends: '全部好友', selected: '指定好友' }
const UNAVAILABLE_CODES = [
  'CONTENT_UNAVAILABLE', 'FORBIDDEN', 'FRIENDSHIP_REQUIRED',
  'SOCIAL_PROFILE_REQUIRED', 'NOT_FOUND'
]
const COMMENT_KEYS = ['commentId', 'shareId', 'parentCommentId', 'author', 'kind', 'text', 'stickerId', 'deleted', 'createdAt']
const COMMENT_AUTHOR_KEYS = ['socialUserId', 'nickname', 'avatarUrl', 'avatarText']
const COMMENT_PAGE_KEYS = ['items', 'nextCursor']
const EMOJIS = Object.freeze(['👍', '🔥', '👏', '😂', '🤔', '😮'])
let mutationSequence = 0

function text(value) {
  return String(value == null ? '' : value).trim()
}

function safeDecode(value) {
  const source = text(value)
  try { return decodeURIComponent(source).trim() } catch (error) { return source }
}

function contractError() {
  const error = new Error('invalid hand share detail')
  error.code = 'SOCIAL_CONTRACT_ERROR'
  return error
}

function protocolText(value) {
  if (typeof value !== 'string') throw contractError()
  return value.trim()
}

function protocolAvatarUrl(value) {
  const source = protocolText(value)
  if (!source) return ''
  try {
    const parsed = new URL(source)
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw contractError()
    return parsed.toString()
  } catch (error) {
    if (error && error.code === 'SOCIAL_CONTRACT_ERROR') throw error
    throw contractError()
  }
}

function assertExactObject(value, allowed, required) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError()
  const keys = Object.keys(value)
  if (keys.some(key => allowed.indexOf(key) < 0)) throw contractError()
  if ((required || []).some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw contractError()
  return value
}

function copyCards(value) {
  if (!Array.isArray(value) || value.some(card => typeof card !== 'string')) throw contractError()
  return value.map(protocolText)
}

function copySnapshotNumber(value, integer) {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw contractError()
  return value
}

function copyHero(value) {
  const source = assertExactObject(value, ['label', 'seat', 'position', 'cards', 'stackBb'], ['label', 'seat', 'position', 'cards'])
  const result = { label: protocolText(source.label), seat: copySnapshotNumber(source.seat, true), position: protocolText(source.position), cards: copyCards(source.cards) }
  if (Object.prototype.hasOwnProperty.call(source, 'stackBb')) result.stackBb = copySnapshotNumber(source.stackBb, false)
  return result
}

function copyPlayer(value) {
  const source = assertExactObject(value, ['label', 'seat', 'position', 'stackBb'], ['label', 'seat', 'position'])
  const result = { label: protocolText(source.label), seat: copySnapshotNumber(source.seat, true), position: protocolText(source.position) }
  if (Object.prototype.hasOwnProperty.call(source, 'stackBb')) result.stackBb = copySnapshotNumber(source.stackBb, false)
  return result
}

function copyBoard(value) {
  const source = assertExactObject(value, ['flop', 'turn', 'river'], ['flop', 'turn', 'river'])
  return { flop: copyCards(source.flop), turn: copyCards(source.turn), river: copyCards(source.river) }
}

function copyAction(value) {
  const source = assertExactObject(value, ['street', 'actor', 'type', 'amountBb'], ['street', 'actor', 'type'])
  const result = { street: protocolText(source.street), actor: protocolText(source.actor), type: protocolText(source.type) }
  if (Object.prototype.hasOwnProperty.call(source, 'amountBb')) result.amountBb = copySnapshotNumber(source.amountBb, false)
  return result
}

function copyShowdown(value) {
  const source = assertExactObject(value, ['actor', 'cards'], ['actor', 'cards'])
  return { actor: protocolText(source.actor), cards: copyCards(source.cards) }
}

function copySnapshot(value) {
  const allowed = ['version', 'hero', 'players', 'board', 'actions', 'effectiveStackBb', 'potBb', 'allInPotBb', 'showdown']
  const source = assertExactObject(value, allowed, ['version', 'hero', 'players', 'board', 'actions', 'showdown'])
  if (source.version !== 1 || !Array.isArray(source.players) || !Array.isArray(source.actions) || !Array.isArray(source.showdown)) throw contractError()
  const result = {
    version: source.version,
    hero: copyHero(source.hero),
    players: source.players.map(copyPlayer),
    board: copyBoard(source.board),
    actions: source.actions.map(copyAction),
    showdown: source.showdown.map(copyShowdown)
  }
  ;['effectiveStackBb', 'potBb', 'allInPotBb'].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = copySnapshotNumber(source[key], false)
  })
  return result
}

function copyPublisher(value) {
  const source = assertExactObject(value, ['socialUserId', 'nickname', 'avatarUrl', 'avatarText'], ['socialUserId', 'nickname', 'avatarUrl', 'avatarText'])
  return {
    socialUserId: protocolText(source.socialUserId),
    nickname: protocolText(source.nickname),
    avatarUrl: protocolAvatarUrl(source.avatarUrl),
    avatarText: protocolText(source.avatarText)
  }
}

function copyDetail(value) {
  const keys = ['shareId', 'publisher', 'scope', 'scopeLabel', 'handSnapshot', 'likedByMe', 'likeCount', 'commentCount', 'createdAt', 'isMine']
  const source = assertExactObject(value, keys, keys)
  const scope = protocolText(source.scope)
  const shareId = protocolText(source.shareId)
  if (!shareId || SCOPES.indexOf(scope) < 0 || protocolText(source.scopeLabel) !== SCOPE_LABELS[scope] ||
    typeof source.likedByMe !== 'boolean' || typeof source.isMine !== 'boolean' ||
    !Number.isSafeInteger(source.likeCount) || source.likeCount < 0 ||
    !Number.isSafeInteger(source.commentCount) || source.commentCount < 0 ||
    !Number.isSafeInteger(source.createdAt) || source.createdAt <= 0) throw contractError()
  return {
    shareId,
    publisher: copyPublisher(source.publisher),
    scope,
    scopeLabel: SCOPE_LABELS[scope],
    handSnapshot: copySnapshot(source.handSnapshot),
    likedByMe: source.likedByMe,
    likeCount: source.likeCount,
    commentCount: source.commentCount,
    createdAt: source.createdAt,
    isMine: source.isMine
  }
}

function copyComment(value, shareId, mySocialUserId) {
  const source = assertExactObject(value, COMMENT_KEYS, COMMENT_KEYS)
  const author = assertExactObject(source.author, COMMENT_AUTHOR_KEYS, COMMENT_AUTHOR_KEYS)
  const commentId = protocolText(source.commentId)
  const commentShareId = protocolText(source.shareId)
  const parentCommentId = protocolText(source.parentCommentId)
  const kind = protocolText(source.kind)
  const content = protocolText(source.text)
  const stickerId = protocolText(source.stickerId)
  const deleted = source.deleted
  if (!commentId || commentShareId !== shareId || typeof deleted !== 'boolean' ||
    !Number.isSafeInteger(source.createdAt) || source.createdAt <= 0) throw contractError()
  if (deleted) {
    if (kind !== 'text' || content !== '该评论已删除' || stickerId) throw contractError()
  } else if (kind === 'text') {
    const length = Array.from(content).length
    if (!length || length > 300 || stickerId) throw contractError()
  } else if (kind === 'sticker') {
    if (content || POKER_STICKER_IDS.indexOf(stickerId) < 0) throw contractError()
  } else {
    throw contractError()
  }
  const copiedAuthor = {
    socialUserId: protocolText(author.socialUserId),
    nickname: protocolText(author.nickname),
    avatarUrl: protocolAvatarUrl(author.avatarUrl),
    avatarText: protocolText(author.avatarText)
  }
  if (!copiedAuthor.socialUserId) throw contractError()
  return {
    commentId,
    shareId: commentShareId,
    parentCommentId,
    author: copiedAuthor,
    kind,
    text: content,
    stickerId,
    deleted,
    createdAt: source.createdAt,
    isReply: !!parentCommentId,
    canDelete: !deleted && !!mySocialUserId && copiedAuthor.socialUserId === mySocialUserId,
    sticker: kind === 'sticker' ? POKER_STICKER_BY_ID[stickerId] : null
  }
}

function copyCommentPage(value, shareId, mySocialUserId) {
  const source = assertExactObject(value, COMMENT_PAGE_KEYS, COMMENT_PAGE_KEYS)
  if (!Array.isArray(source.items)) throw contractError()
  let nextCursor = null
  if (source.nextCursor !== null) {
    nextCursor = protocolText(source.nextCursor)
    if (!nextCursor || nextCursor.length > 2048) throw contractError()
  }
  return {
    items: source.items.map(item => copyComment(item, shareId, mySocialUserId)),
    nextCursor
  }
}

function copyMySocialUserId(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.socialUserId !== 'string') return ''
  return value.socialUserId.trim()
}

function copyInteractionResult(value, keys, shareId, mySocialUserId) {
  const source = assertExactObject(value, keys, keys)
  if (!Number.isSafeInteger(source.commentCount) || source.commentCount < 0) throw contractError()
  return { comment: copyComment(source.comment, shareId, mySocialUserId), commentCount: source.commentCount }
}

function copyDeleteResult(value, shareId, mySocialUserId) {
  const source = assertExactObject(value, ['comment', 'commentCount'], ['comment'])
  const result = { comment: copyComment(source.comment, shareId, mySocialUserId) }
  if (Object.prototype.hasOwnProperty.call(source, 'commentCount')) {
    if (!Number.isSafeInteger(source.commentCount) || source.commentCount < 0) throw contractError()
    result.commentCount = source.commentCount
  }
  return result
}

function copyLikeResult(value, shareId) {
  const keys = ['shareId', 'likedByMe', 'likeCount']
  const source = assertExactObject(value, keys, keys)
  if (protocolText(source.shareId) !== shareId || typeof source.likedByMe !== 'boolean' ||
    !Number.isSafeInteger(source.likeCount) || source.likeCount < 0) throw contractError()
  return { shareId, likedByMe: source.likedByMe, likeCount: source.likeCount }
}

function mergeComments(current, incoming, prepend) {
  const seen = Object.create(null)
  const merged = []
  const values = prepend ? incoming.concat(current) : current.concat(incoming)
  values.forEach(item => {
    if (!item || seen[item.commentId]) return
    seen[item.commentId] = true
    merged.push(item)
  })
  return merged
}

function mutationChain(page, action, shareId, payload) {
  if (!page._interactionMutationChains) page._interactionMutationChains = Object.create(null)
  const slot = JSON.stringify([action, shareId])
  const fingerprint = JSON.stringify([action, shareId].concat(payload))
  const existing = page._interactionMutationChains[slot]
  if (existing && existing.fingerprint === fingerprint) return existing
  mutationSequence += 1
  const entry = {
    fingerprint,
    id: ['ui', action, Date.now(), mutationSequence].join('_')
  }
  page._interactionMutationChains[slot] = entry
  return entry
}

function clearMutationChain(page, action, shareId, entry) {
  if (!page._interactionMutationChains) return
  const slot = JSON.stringify([action, shareId])
  if (page._interactionMutationChains[slot] === entry) delete page._interactionMutationChains[slot]
}

function unavailableError(error) {
  return UNAVAILABLE_CODES.indexOf(text(error && error.code)) >= 0
}

Page({
  data: {
    shareId: '',
    detail: null,
    status: 'loading',
    errorMessage: '',
    mySocialUserId: '',
    comments: [],
    commentsStatus: 'idle',
    commentsNextCursor: null,
    commentsLoadingMore: false,
    commentDraft: '',
    commentSubmitting: false,
    replyTo: null,
    emojiPanelVisible: false,
    stickerPanelVisible: false,
    likeSubmitting: false,
    emojis: EMOJIS,
    stickers: POKER_STICKERS
  },

  onLoad(options) {
    this._detailAttached = true
    this._detailVisible = true
    this._detailHasShown = false
    this._detailGeneration = Number(this._detailGeneration) || 0
    this._detailFlight = null
    this._commentsFlight = null
    this._likeFlight = null
    this._commentWriteFlight = null
    const shareId = safeDecode(options && options.shareId)
    this.invalidateDetail()
    this.setData({ shareId, detail: null, status: 'loading', errorMessage: '' })
    return this.loadDetail()
  },

  onShow() {
    if (!this._detailHasShown) {
      this._detailHasShown = true
      this._detailAttached = true
      this._detailVisible = true
      return Promise.resolve()
    }
    if (this._detailVisible) return Promise.resolve()
    this._detailAttached = true
    this._detailVisible = true
    this.invalidateDetail()
    return this.loadDetail()
  },

  onHide() {
    this._detailVisible = false
    this.invalidateDetail()
  },

  onUnload() {
    this._detailAttached = false
    this._detailVisible = false
    this.invalidateDetail()
  },

  invalidateDetail() {
    this._detailGeneration = (Number(this._detailGeneration) || 0) + 1
    this._detailFlight = null
    this._commentsFlight = null
    this._likeFlight = null
    this._commentWriteFlight = null
  },

  isCurrentDetail(generation, shareId) {
    return this._detailAttached !== false && this._detailVisible !== false &&
      generation === this._detailGeneration && shareId === text(this.data.shareId)
  },

  loadDetail() {
    if (this._detailFlight) return this._detailFlight
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    if (!shareId) {
      this.setData({ detail: null, status: 'unavailable', errorMessage: '这手分享已失效或不可访问。' })
      return Promise.resolve()
    }
    this.setData({
      detail: null,
      status: 'loading',
      errorMessage: '',
      mySocialUserId: '',
      comments: [],
      commentsStatus: 'loading',
      commentsNextCursor: null,
      commentsLoadingMore: false,
      commentSubmitting: false,
      likeSubmitting: false,
      replyTo: null
    })
    const flight = (async () => {
      try {
        const detail = copyDetail(await socialService.getHandShare(shareId))
        if (!this.isCurrentDetail(generation, shareId)) return
        this.setData({ detail, status: 'ready', errorMessage: '' })
        await this.loadInitialInteractions(generation, shareId)
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        this.setData({
          detail: null,
          status: unavailableError(error) ? 'unavailable' : 'error',
          comments: [],
          commentsStatus: unavailableError(error) ? 'unavailable' : 'error',
          errorMessage: unavailableError(error) ? '这手分享已失效或不可访问。' : '暂时无法读取分享，请检查网络后重试。'
        })
      }
    })()
    this._detailFlight = flight
    flight.then(() => {
      if (this._detailFlight === flight) this._detailFlight = null
    }, () => {
      if (this._detailFlight === flight) this._detailFlight = null
    })
    return flight
  },

  loadInitialInteractions(generation, shareId) {
    const profileTask = Promise.resolve()
      .then(() => socialService.getMySocialProfile())
      .then(copyMySocialUserId, () => '')
    const commentsTask = Promise.resolve()
      .then(() => socialService.listComments({ shareId, cursor: '', limit: 20 }))
    return Promise.all([profileTask, commentsTask]).then(values => {
      if (!this.isCurrentDetail(generation, shareId)) return
      const mySocialUserId = values[0]
      const page = copyCommentPage(values[1], shareId, mySocialUserId)
      this.setData({
        mySocialUserId,
        comments: page.items,
        commentsStatus: 'ready',
        commentsNextCursor: page.nextCursor,
        commentsLoadingMore: false
      })
    }).catch(error => {
      if (!this.isCurrentDetail(generation, shareId)) return
      if (unavailableError(error)) {
        this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', commentsNextCursor: null })
        return
      }
      this.setData({ mySocialUserId: '', comments: [], commentsStatus: 'error', commentsNextCursor: null, commentsLoadingMore: false })
    })
  },

  loadMoreComments() {
    if (this._commentsFlight) return this._commentsFlight
    const shareId = text(this.data.shareId)
    const cursor = this.data.commentsNextCursor
    const generation = this._detailGeneration
    if (!shareId || typeof cursor !== 'string' || !cursor || this.data.commentsStatus !== 'ready') return Promise.resolve(this.data.comments)
    this.setData({ commentsLoadingMore: true })
    const flight = (async () => {
      try {
        const page = copyCommentPage(
          await socialService.listComments({ shareId, cursor, limit: 20 }),
          shareId,
          this.data.mySocialUserId
        )
        if (!this.isCurrentDetail(generation, shareId)) return this.data.comments
        const comments = mergeComments(this.data.comments, page.items, false)
        this.setData({ comments, commentsNextCursor: page.nextCursor, commentsLoadingMore: false })
        return comments
      } catch (error) {
        if (this.isCurrentDetail(generation, shareId)) {
          if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable' })
          else this.setData({ commentsLoadingMore: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '评论加载失败', icon: 'none' })
        }
        return this.data.comments
      }
    })()
    this._commentsFlight = flight
    flight.then(() => { if (this._commentsFlight === flight) this._commentsFlight = null }, () => { if (this._commentsFlight === flight) this._commentsFlight = null })
    return flight
  },

  toggleLike() {
    if (this._likeFlight) return this._likeFlight
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    const detail = this.data.detail
    if (!shareId || !detail || this.data.status !== 'ready' || this.data.commentsStatus !== 'ready') return Promise.resolve()
    const liked = !detail.likedByMe
    const mutation = mutationChain(this, 'set_like', shareId, [liked])
    this.setData({ likeSubmitting: true })
    const flight = (async () => {
      try {
        const result = copyLikeResult(await socialService.setLike({
          shareId,
          liked,
          clientMutationId: mutation.id
        }), shareId)
        clearMutationChain(this, 'set_like', shareId, mutation)
        if (!this.isCurrentDetail(generation, shareId)) return
        this.setData({ detail: Object.assign({}, this.data.detail, result), likeSubmitting: false })
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', likeSubmitting: false })
        else {
          this.setData({ likeSubmitting: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '操作失败，请重试', icon: 'none' })
        }
      }
    })()
    this._likeFlight = flight
    flight.then(() => { if (this._likeFlight === flight) this._likeFlight = null }, () => { if (this._likeFlight === flight) this._likeFlight = null })
    return flight
  },

  onCommentInput(event) {
    const value = event && event.detail && event.detail.value
    this.setData({ commentDraft: typeof value === 'string' ? Array.from(value).slice(0, 300).join('') : '' })
  },

  toggleEmojiPanel() {
    this.setData({ emojiPanelVisible: !this.data.emojiPanelVisible, stickerPanelVisible: false })
  },

  toggleStickerPanel() {
    this.setData({ stickerPanelVisible: !this.data.stickerPanelVisible, emojiPanelVisible: false })
  },

  appendEmoji(event) {
    const emoji = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.emoji
    if (typeof emoji !== 'string' || EMOJIS.indexOf(emoji) < 0) return
    const next = Array.from(String(this.data.commentDraft || '') + emoji).slice(0, 300).join('')
    this.setData({ commentDraft: next, emojiPanelVisible: false })
  },

  replyToComment(event) {
    const commentId = text(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.commentId)
    const target = this.data.comments.find(item => item.commentId === commentId)
    if (!target || target.deleted || target.parentCommentId) return
    this.setData({ replyTo: { commentId: target.commentId, nickname: target.author.nickname }, stickerPanelVisible: false, emojiPanelVisible: false })
  },

  cancelReply() {
    this.setData({ replyTo: null })
  },

  submitComment() {
    const content = typeof this.data.commentDraft === 'string' ? this.data.commentDraft.trim() : ''
    const length = Array.from(content).length
    if (!length || length > 300) return Promise.resolve()
    return this.createCommentRequest({
      parentCommentId: this.data.replyTo && this.data.replyTo.commentId || '',
      kind: 'text',
      text: content,
      stickerId: ''
    })
  },

  chooseSticker(event) {
    const stickerId = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.stickerId
    if (typeof stickerId !== 'string' || POKER_STICKER_IDS.indexOf(stickerId) < 0) return Promise.resolve()
    return this.createCommentRequest({
      parentCommentId: this.data.replyTo && this.data.replyTo.commentId || '',
      kind: 'sticker',
      text: '',
      stickerId
    })
  },

  createCommentRequest(input) {
    if (this._commentWriteFlight) return this._commentWriteFlight
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    if (!shareId || !this.data.detail || this.data.status !== 'ready' || this.data.commentsStatus !== 'ready') return Promise.resolve()
    const mutation = mutationChain(this, 'create_comment', shareId, [input.parentCommentId, input.kind, input.text, input.stickerId])
    this.setData({ commentSubmitting: true })
    const flight = (async () => {
      try {
        const result = copyInteractionResult(await socialService.createComment({
          shareId,
          parentCommentId: input.parentCommentId,
          kind: input.kind,
          text: input.text,
          stickerId: input.stickerId,
          clientMutationId: mutation.id
        }), ['comment', 'commentCount'], shareId, this.data.mySocialUserId)
        if (!this.isCurrentDetail(generation, shareId)) return
        this.setData({
          comments: mergeComments(this.data.comments, [result.comment], true),
          detail: Object.assign({}, this.data.detail, { commentCount: result.commentCount }),
          commentDraft: '',
          commentSubmitting: false,
          replyTo: null,
          emojiPanelVisible: false,
          stickerPanelVisible: false
        })
        clearMutationChain(this, 'create_comment', shareId, mutation)
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', commentSubmitting: false })
        else {
          this.setData({ commentSubmitting: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '评论发送失败', icon: 'none' })
        }
      }
    })()
    this._commentWriteFlight = flight
    flight.then(() => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null }, () => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null })
    return flight
  },

  deleteComment(event) {
    if (this._commentWriteFlight) return this._commentWriteFlight
    const commentId = text(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.commentId)
    const target = this.data.comments.find(item => item.commentId === commentId)
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    if (!target || !target.canDelete || target.deleted || !shareId || this.data.commentsStatus !== 'ready') return Promise.resolve()
    const mutation = mutationChain(this, 'delete_comment', shareId, [commentId])
    this.setData({ commentSubmitting: true })
    const flight = (async () => {
      try {
        const result = copyDeleteResult(await socialService.deleteComment({
          commentId,
          clientMutationId: mutation.id
        }), shareId, this.data.mySocialUserId)
        if (result.comment.commentId !== commentId || !result.comment.deleted) throw contractError()
        if (!this.isCurrentDetail(generation, shareId)) return
        clearMutationChain(this, 'delete_comment', shareId, mutation)
        if (!Object.prototype.hasOwnProperty.call(result, 'commentCount')) {
          this.setData({
            detail: null,
            status: 'unavailable',
            comments: [],
            commentsStatus: 'unavailable',
            commentsNextCursor: null,
            commentSubmitting: false
          })
          return
        }
        this.setData({
          comments: this.data.comments.map(item => item.commentId === commentId ? result.comment : item),
          detail: Object.assign({}, this.data.detail, { commentCount: result.commentCount }),
          commentSubmitting: false
        })
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', commentSubmitting: false })
        else {
          this.setData({ commentSubmitting: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })()
    this._commentWriteFlight = flight
    flight.then(() => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null }, () => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null })
    return flight
  },

  retry() {
    if (this.data.status === 'loading') return this._detailFlight || Promise.resolve()
    this.invalidateDetail()
    return this.loadDetail()
  },

  retryLoad() {
    return this.retry()
  }
})
