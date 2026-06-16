// Shared DTE fixtures (real values from a signed VIELA S.A. invoice).
export const REAL_CDC = '01800549937005005014115022026021410125083658';

export const DTE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>
<rEnviDe xmlns="http://ekuatia.set.gov.py/sifen/xsd"><dId>946208</dId><xDE><rDE>
<dVerFor>150</dVerFor>
<DE Id="${REAL_CDC}">
  <dDVId>8</dDVId>
  <gTimb><iTiDE>1</iTiDE><dDesTiDE>Factura electrónica</dDesTiDE></gTimb>
  <gDatGralOpe>
    <dFeEmiDE>2026-02-14T16:53:05</dFeEmiDE>
    <gOpeCom><cMoneOpe>PYG</cMoneOpe></gOpeCom>
    <gEmis><dRucEm>80054993</dRucEm><dDVEmi>7</dDVEmi><dNomEmi>VIELA S.A.</dNomEmi></gEmis>
    <gDatRec><dRucRec>4904579</dRucRec><dDVRec>2</dDVRec><dNomRec>ALBERTO VELAZQUEZ</dNomRec></gDatRec>
  </gDatGralOpe>
  <gDtipDE>
    <gCamItem>
      <dCodInt>166408</dCodInt><dDesProSer>AGUA MINERAL LA FUENTE SIN GAS 10LT.</dDesProSer>
      <dCantProSer>3</dCantProSer>
      <gValorItem><dPUniProSer>18000</dPUniProSer><dTotBruOpeItem>54000</dTotBruOpeItem>
        <gValorRestaItem><dTotOpeItem>54000</dTotOpeItem></gValorRestaItem></gValorItem>
      <gCamIVA><iAfecIVA>1</iAfecIVA><dTasaIVA>10</dTasaIVA><dBasGravIVA>49090.91</dBasGravIVA><dLiqIVAItem>4909.09</dLiqIVAItem></gCamIVA>
    </gCamItem>
    <gCamItem>
      <dCodInt>250328</dCodInt><dDesProSer>JUGUETE CHARGE ROBOT 2244/38-65</dDesProSer>
      <dCantProSer>1</dCantProSer>
      <gValorItem><dPUniProSer>150000</dPUniProSer><dTotBruOpeItem>150000</dTotBruOpeItem>
        <gValorRestaItem><dTotOpeItem>150000</dTotOpeItem></gValorRestaItem></gValorItem>
      <gCamIVA><iAfecIVA>1</iAfecIVA><dTasaIVA>10</dTasaIVA><dBasGravIVA>136363.64</dBasGravIVA><dLiqIVAItem>13636.36</dLiqIVAItem></gCamIVA>
    </gCamItem>
    <gCamItem>
      <dCodInt>154566</dCodInt><dDesProSer>ACEITE DE OLIVA OLICA EXTRA VIRGEN 250ML.</dDesProSer>
      <dCantProSer>1</dCantProSer>
      <gValorItem><dPUniProSer>33500</dPUniProSer><dTotBruOpeItem>33500</dTotBruOpeItem>
        <gValorRestaItem><dTotOpeItem>33500</dTotOpeItem></gValorRestaItem></gValorItem>
      <gCamIVA><iAfecIVA>1</iAfecIVA><dTasaIVA>5</dTasaIVA><dBasGravIVA>31904.76</dBasGravIVA><dLiqIVAItem>1595.24</dLiqIVAItem></gCamIVA>
    </gCamItem>
  </gDtipDE>
  <gTotSub>
    <dSub5>33500</dSub5><dSub10>204000</dSub10>
    <dTotGralOpe>237500</dTotGralOpe>
    <dIVA5>1595.24</dIVA5><dIVA10>18545.45</dIVA10><dTotIVA>20140.69</dTotIVA>
    <dBaseGrav5>31904.76</dBaseGrav5><dBaseGrav10>185454.55</dBaseGrav10>
  </gTotSub>
</DE>
</rDE></xDE></rEnviDe></env:Body></env:Envelope>`;
