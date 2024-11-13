import { strict as assert } from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Validator } from '../index.js'

function localPath (fileName) {
  return fileURLToPath(new URL(fileName, import.meta.url))
}

const invalidRefsSpec = localPath('./validation/invalid-refs.yaml')
const recursiveRefsSpec = localPath('./validation/openapi-recursive.v3.json')

test('invalid refs in YAML fail validation', async (t) => {
  const validator = new Validator()
  const res = await validator.validate(invalidRefsSpec)
  assert.equal(res.valid, false, 'validation fails')
  assert.equal(
    res.errors,
    "Can't resolve #/components/schemas/nonExisting1",
    'correct error message'
  )
})

test('recursive refs pass validation', async (t) => {
  const validator = new Validator()
  const res = await validator.validate(recursiveRefsSpec)
  assert.equal(res.valid, true, 'validation succeeds')
})
