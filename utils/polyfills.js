function installArrayPolyfills() {
  if (!Array.prototype.includes) {
    Array.prototype.includes = function (value) {
      return this.indexOf(value) !== -1
    }
  }

  if (!Array.prototype.find) {
    Array.prototype.find = function (predicate, thisArg) {
      for (let index = 0; index < this.length; index += 1) {
        if (predicate.call(thisArg, this[index], index, this)) {
          return this[index]
        }
      }
      return undefined
    }
  }

  if (!Array.prototype.some) {
    Array.prototype.some = function (predicate, thisArg) {
      for (let index = 0; index < this.length; index += 1) {
        if (predicate.call(thisArg, this[index], index, this)) {
          return true
        }
      }
      return false
    }
  }
}

function installPolyfills() {
  installArrayPolyfills()
}

module.exports = {
  installPolyfills
}
