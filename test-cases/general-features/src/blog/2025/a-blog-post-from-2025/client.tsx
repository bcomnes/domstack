/** @jsxImportSource preact */
import { render } from 'preact'

export const page = () => {
  return (
    <div>
      look ma, client side jsx!
    </div>
  )
}

const renderTarget = document.querySelector('.tsx-app')
if (renderTarget) {
  render(page(), renderTarget)
}
