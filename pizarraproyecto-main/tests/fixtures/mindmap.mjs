export const mindmapExample=String.raw`@startmindmap
* Sistema Lineal de Primer Orden: X' = A(t)X + F(t)
** Continuidad de coeficientes en A(t) y F(t)
*** Existencia y unicidad de solución para PVI con X(t0) = X0
** Sistema Homogéneo (F(t) = 0 -> X' = A(t)X)
*** Principio de Superposición
**** Toda combinación lineal c1*X1 + ... + ck*Xk es vector solución
*** Independencia Lineal de soluciones
**** Criterio del Wronskiano: W(X1, ..., Xn) != 0
***** Existencia de Conjunto Fundamental de n soluciones L.I.
****** Solución General Homogénea (Función Complementaria Xc)
** Sistema No Homogéneo (F(t) != 0)
*** Obtención de Solución Particular Xp (libre de parámetros)
**** Solución General Completa: X = Xc + Xp
@endmindmap`
