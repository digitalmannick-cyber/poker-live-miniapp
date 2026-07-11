const LAUNCH_ANIMATION_DURATION = 2950

let consumed = false

function consumeLaunchAnimation() {
  if (consumed) return false
  consumed = true
  return true
}

function getLaunchAnimationDuration() {
  return LAUNCH_ANIMATION_DURATION
}

module.exports = {
  consumeLaunchAnimation,
  getLaunchAnimationDuration,
  __test: {
    reset() {
      consumed = false
    }
  }
}
