import styles from './home.module.css'

export default function Home() {
  return <main className={styles.home}>
    <nav className={styles.choices} aria-label="Elegir aplicación">
      <a className={styles.choice} href="/pizarra/" aria-label="Abrir Pizarra"><img src="/pizarra-home.svg" alt="Pizarra" /></a>
      <a className={styles.choice} href="/estudio" aria-label="Abrir organizador de estudio"><img src="/icon.svg" alt="Organizador de estudio" /></a>
    </nav>
  </main>
}
